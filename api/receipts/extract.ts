import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { requireCaller, supabaseEnv } from '../_lib/auth.js'

/**
 * Reads a slip photo/PDF with Claude and suggests a project + category for it.
 *
 * POST { path } where path is an object in the private 'receipts' bucket.
 * The caller's Supabase JWT is verified before anything else; the file and the suggestion
 * context are then read *as that user* (RLS applies).
 *
 * AI is optional: without ANTHROPIC_API_KEY this returns 200 { configured: false, message } and the
 * app falls back to manual entry. Any failure talking to Claude degrades the same way.
 */

const MODEL = 'claude-sonnet-5-5'
const CATEGORIES = ['materials', 'labour', 'subcontractor', 'plant_hire', 'transport', 'permits', 'overheads', 'other'] as const
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type ImageType = (typeof IMAGE_TYPES)[number]
const MAX_BYTES = 5 * 1024 * 1024 // Claude's per-image limit

// anyOf rather than `type: [X, 'null']`: the form structured outputs supports for nullable fields.
const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })

/** A real calendar date in YYYY-MM-DD form. */
function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** JSON schema for structured output. Every property required; nulls for anything not visible. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['extraction', 'suggestion'],
  properties: {
    extraction: {
      type: 'object',
      additionalProperties: false,
      required: ['supplier', 'date', 'slip_number', 'total_incl', 'vat', 'amount_excl', 'payment_method', 'card_last4', 'line_items'],
      properties: {
        supplier: { ...nullable('string'), description: 'Trading name of the store or supplier, as printed.' },
        date: { ...nullable('string'), description: 'Transaction date as YYYY-MM-DD.' },
        slip_number: { ...nullable('string'), description: 'Slip, receipt, invoice or transaction number.' },
        total_incl: { ...nullable('number'), description: 'Total paid including VAT, in rand.' },
        vat: { ...nullable('number'), description: 'VAT amount in rand, if shown.' },
        amount_excl: { ...nullable('number'), description: 'Total excluding VAT in rand, if shown.' },
        payment_method: { ...nullable('string'), description: 'card, cash, eft, account or null.' },
        card_last4: { ...nullable('string'), description: 'Last 4 digits of the card if printed, else null.' },
        line_items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['description', 'quantity', 'amount'],
            properties: { description: { type: 'string' }, quantity: nullable('number'), amount: nullable('number') },
          },
        },
      },
    },
    suggestion: {
      type: 'object',
      additionalProperties: false,
      required: ['project_id', 'category', 'confidence', 'reason'],
      properties: {
        project_id: { ...nullable('string'), description: 'id of the most likely project from the list, or null for company overhead / unsure.' },
        category: { type: 'string', enum: [...CATEGORIES] },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        reason: { type: 'string', description: 'One short sentence explaining the suggestion.' },
      },
    },
  },
} as const

const SYSTEM = `You read South African till slips and supplier invoices for a small construction company and file them.

1. Extract what is printed. Amounts are in rand (ZAR). South African VAT is usually 15% and is often shown as "VAT" or "Tax"; many slips show only the VAT-inclusive total. Use null for anything you cannot read; never guess digits.
2. Suggest the expense category and project:
   - Categories: materials (building supplies, hardware, timber, cement, paint, plumbing/electrical stock), labour (wages, casual workers), subcontractor (specialist trades invoicing us), plant_hire (equipment/machinery rental, skips, scaffolding), transport (fuel, tolls, delivery, vehicle costs), permits (council plans, inspections, fees), overheads (office, phone, software, insurance, bank charges), other.
   - Use the supplied active projects and the company's recent expenses. Strong signals: the same supplier was recently booked to a project; a delivery/site address on the slip matches a project's site address; a project or client name appears on the slip.
   - If nothing points to a specific project, return project_id null (overhead) with low confidence rather than guessing.`

function mediaTypeFor(path: string, blobType: string): string {
  if (blobType && blobType !== 'application/octet-stream') return blobType
  const ext = path.split('.').pop()?.toLowerCase()
  return ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseEnv()) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }
  // Authenticate before anything else, including the "not configured" answer.
  const caller = await requireCaller(req)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { path } = (req.body ?? {}) as { path?: unknown }
  if (typeof path !== 'string' || !path.startsWith('receipts/') || path.includes('..')) {
    res.status(400).json({ error: 'A receipts/ storage path is required.' })
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(200).json({ configured: false, message: 'AI slip reading is not set up, so fill in the details by hand. The slip has been saved.' })
    return
  }

  const { db, user } = caller

  // The slip itself, read with the caller's own permissions.
  const download = await db.storage.from('receipts').download(path)
  if (download.error || !download.data) {
    res.status(404).json({ error: 'Slip not found.' })
    return
  }
  const bytes = Buffer.from(await download.data.arrayBuffer())
  const mediaType = mediaTypeFor(path, download.data.type)
  if (bytes.length > MAX_BYTES) {
    res.status(200).json({ configured: false, message: 'This file is too large for automatic reading (over 5 MB). Fill in the details by hand.' })
    return
  }
  const isPdf = mediaType === 'application/pdf'
  if (!isPdf && !IMAGE_TYPES.includes(mediaType as ImageType)) {
    res.status(200).json({ configured: false, message: `Can't read ${mediaType} files automatically (try JPEG or PNG). Fill in the details by hand.` })
    return
  }

  // Compact context for the suggestion.
  const [projectsRes, recentRes] = await Promise.all([
    db
      .from('projects')
      .select('id, name, code, site_address, status, companies(name), contacts(first_name, last_name)')
      .in('status', ['active', 'planned', 'on_hold'])
      .limit(60),
    db
      .from('expenses')
      .select('supplier, category, project_id, date')
      .eq('created_by', user.id)
      .not('supplier', 'is', null)
      .order('date', { ascending: false })
      .limit(40),
  ])
  type ProjectRow = {
    id: string
    name: string
    code: string | null
    site_address: string | null
    status: string
    companies: { name: string } | { name: string }[] | null
    contacts: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null
  }
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
  const projects = ((projectsRes.data ?? []) as ProjectRow[]).map((p) => {
    const co = one(p.companies)
    const ct = one(p.contacts)
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      site: p.site_address,
      status: p.status,
      client: co?.name ?? (ct ? `${ct.first_name} ${ct.last_name}`.trim() : null),
    }
  })
  const projectIds = new Set(projects.map((p) => p.id))
  const recent = (recentRes.data ?? []) as { supplier: string; category: string; project_id: string | null; date: string }[]
  const context = JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    active_projects: projects,
    recent_expenses: recent.map((r) => ({ supplier: r.supplier, category: r.category, project_id: r.project_id, date: r.date })),
  })

  const fileBlock: Anthropic.Beta.BetaContentBlockParam = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType as ImageType, data: bytes.toString('base64') } }

  const client = new Anthropic()
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Server-side fallback: if the model declines, the API retries on Anthropic's recommended model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Reading a slip is a short, well-specified task; medium keeps latency down on a phone.
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            fileBlock,
            { type: 'text', text: `Company context (JSON):\n${context}\n\nRead this slip and suggest where it belongs.` },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      res.status(200).json({ configured: false, message: "Couldn't read this slip automatically. Fill in the details by hand." })
      return
    }
    if (response.stop_reason === 'max_tokens') {
      console.error('Slip extraction hit max_tokens')
      res.status(200).json({ configured: false, message: 'This slip was too long to read automatically. Fill in the details by hand.' })
      return
    }
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text
    if (!text) throw new Error('Empty response')
    const parsed = JSON.parse(text) as {
      extraction: Record<string, unknown>
      suggestion: { project_id: string | null; category: string; confidence: string; reason: string }
    }
    // Only a well-formed date reaches the form; anything else leaves the date for the person.
    if (!isYmd(parsed.extraction.date)) parsed.extraction.date = null
    // Never let a hallucinated id through.
    if (parsed.suggestion.project_id && !projectIds.has(parsed.suggestion.project_id)) parsed.suggestion.project_id = null
    if (!CATEGORIES.includes(parsed.suggestion.category as (typeof CATEGORIES)[number])) parsed.suggestion.category = 'other'
    res.status(200).json({ configured: true, extraction: parsed.extraction, suggestion: parsed.suggestion })
  } catch (error) {
    let message = 'Slip reading failed. Fill in the details by hand.'
    if (error instanceof Anthropic.AuthenticationError) message = 'The AI key is invalid. Fill in the details by hand.'
    else if (error instanceof Anthropic.RateLimitError) message = 'Slip reading is busy right now. Fill in the details by hand.'
    else if (error instanceof Anthropic.APIError) console.error('Claude API error', error.status, error.message)
    else console.error('Slip extraction failed', error)
    res.status(200).json({ configured: false, message })
  }
}
