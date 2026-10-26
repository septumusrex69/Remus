import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { round2, zar } from './quotePdf.js'

/**
 * The Remus tools a person's own Claude can call through the connector (api/mcp.ts).
 *
 * `admin` is a service-role client, so RLS does not apply here: every tool is written for the
 * one person the token belongs to, writes stamp created_by with their id, and write tools check
 * `canWrite` (active and not Read Only), the same rule the database enforces for the app.
 */

export interface ConnectorUser {
  id: string
  name: string
  canWrite: boolean
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const CATEGORIES = ['materials', 'labour', 'subcontractor', 'plant_hire', 'transport', 'permits', 'overheads', 'other'] as const
const UNITS = ['m²', 'm³', 'm', 'each', 'hours', 'day', 'sum'] as const
const PROJECT_STATUSES = ['lead', 'planned', 'active', 'on_hold', 'completed', 'cancelled'] as const

/** Today's date in South Africa (the server runs in UTC). */
function saToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date())
}

function appUrl(path: string): string {
  return `${(process.env.APP_URL || 'https://remus-xi.vercel.app').replace(/\/$/, '')}${path}`
}

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })
const fail = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: message }] })

/** Escapes a value for a PostgREST ilike filter inside .or(). */
function like(s: string): string {
  return `%${s.replace(/[%_,()*\\]/g, ' ').trim()}%`
}

async function findProject(db: SupabaseClient, ref: string): Promise<{ id: string; name: string; code: string | null } | string> {
  const r = ref.trim()
  if (/^[0-9a-f-]{36}$/i.test(r)) {
    const { data } = await db.from('projects').select('id, name, code').eq('id', r).maybeSingle()
    return data ?? `No project with id ${r}.`
  }
  const { data } = await db.from('projects').select('id, name, code, status').or(`code.ilike.${like(r)},name.ilike.${like(r)}`).limit(10)
  const rows = data ?? []
  const exact = rows.find((p) => p.code?.toLowerCase() === r.toLowerCase() || p.name.toLowerCase() === r.toLowerCase())
  if (exact) return exact
  if (rows.length === 1) return rows[0]
  if (rows.length === 0) return `No project matches "${r}". Use list_projects to see them.`
  return `"${r}" matches several projects: ${rows.map((p) => `${p.name}${p.code ? ` (${p.code})` : ''}`).join('; ')}. Be more specific or pass the id.`
}

export function buildServer(admin: SupabaseClient, user: ConnectorUser): McpServer {
  const server = new McpServer(
    { name: 'remus', version: '1.0.0' },
    {
      instructions:
        'Remus is the management app of a small South African construction company. Amounts are in rand (ZAR); VAT is normally 15%. ' +
        'Use it to look up clients, projects, quotes and finances, to file expenses from till slips, and to draft quotes. ' +
        'Drafted quotes stay drafts until a person reviews and sends them in Remus. Confirm amounts with the user before filing when a slip is unclear.',
    },
  )
  const readOnly = { readOnlyHint: true, openWorldHint: false }
  const denyWrite = () => fail('Your Remus access is read-only, so this change was not made.')

  // ---------- Look-ups ----------

  server.registerTool(
    'search_clients',
    {
      title: 'Search clients',
      description: 'Find client companies and private clients (people) by name, email or phone. Returns ids to use in other tools.',
      inputSchema: { query: z.string().min(1).describe('Part of a name, email or phone number') },
      annotations: readOnly,
    },
    async ({ query }) => {
      const q = like(query)
      const [co, ct] = await Promise.all([
        admin.from('companies').select('id, name, email, phone, city').or(`name.ilike.${q},email.ilike.${q},phone.ilike.${q}`).limit(15),
        admin.from('contacts').select('id, first_name, last_name, email, phone, mobile, company_id').or(`first_name.ilike.${q},last_name.ilike.${q},email.ilike.${q},phone.ilike.${q},mobile.ilike.${q}`).limit(15),
      ])
      return ok({ companies: co.data ?? [], people: ct.data ?? [] })
    },
  )

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'Projects with contract value, costs so far and profit (amounts excl. VAT). Defaults to planned and active projects.',
      inputSchema: { status: z.enum(PROJECT_STATUSES).optional().describe('Only this status'), include_all: z.boolean().optional().describe('Include completed, cancelled, on-hold and leads') },
      annotations: readOnly,
    },
    async ({ status, include_all }) => {
      let q = admin.from('projects').select('id, code, name, status, site_address, start_date, end_date, company_id, contact_id').order('created_at', { ascending: false }).limit(100)
      if (status) q = q.eq('status', status)
      else if (!include_all) q = q.in('status', ['planned', 'active'])
      const { data: projects, error } = await q
      if (error) return fail(error.message)
      const ids = (projects ?? []).map((p) => p.id)
      const { data: fin } = ids.length
        ? await admin.from('project_financials').select('project_id, revised_contract, expenses_total, gross_profit, margin_pct, invoiced, received').in('project_id', ids)
        : { data: [] }
      const byId = new Map((fin ?? []).map((f) => [f.project_id, f]))
      return ok((projects ?? []).map((p) => ({ ...p, financials: byId.get(p.id) ?? null, link: appUrl(`/projects/${p.id}`) })))
    },
  )

  server.registerTool(
    'get_project',
    {
      title: 'Get a project',
      description: 'One project in detail: financials, costs by category, recent expenses, invoices and payments, variations. Pass the id, code (e.g. P-0007) or name.',
      inputSchema: { project: z.string().min(1) },
      annotations: readOnly,
    },
    async ({ project }) => {
      const p = await findProject(admin, project)
      if (typeof p === 'string') return fail(p)
      const [row, fin, exp, inv, pay, vars] = await Promise.all([
        admin.from('projects').select('*').eq('id', p.id).single(),
        admin.from('project_financials').select('*').eq('project_id', p.id).maybeSingle(),
        admin.from('expenses').select('date, supplier, description, category, amount_excl, vat, paid').eq('project_id', p.id).order('date', { ascending: false }).limit(25),
        admin.from('invoices').select('number, issue_date, due_date, description, amount_excl, vat, status').eq('project_id', p.id).order('issue_date', { ascending: false }),
        admin.from('payments').select('date, amount, method, reference').eq('project_id', p.id).order('date', { ascending: false }),
        admin.from('variations').select('date, description, amount_excl, approved').eq('project_id', p.id).order('date', { ascending: false }),
      ])
      return ok({ project: row.data, financials: fin.data, recent_expenses: exp.data, invoices: inv.data, payments: pay.data, variations: vars.data, link: appUrl(`/projects/${p.id}`) })
    },
  )

  server.registerTool(
    'list_quotes',
    {
      title: 'List quotes',
      description: 'Recent quotes with totals. Optionally filter by status.',
      inputSchema: { status: z.enum(['draft', 'sent', 'accepted', 'declined', 'expired']).optional(), limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnly,
    },
    async ({ status, limit }) => {
      let q = admin.from('quotes').select('id, number, title, status, issue_date, valid_until, company_id, contact_id, project_id').order('created_at', { ascending: false }).limit(limit ?? 25)
      if (status) q = q.eq('status', status)
      const { data, error } = await q
      if (error) return fail(error.message)
      const ids = (data ?? []).map((x) => x.id)
      const { data: totals } = ids.length ? await admin.from('quote_totals').select('quote_id, total_excl, total_incl, estimated_cost').in('quote_id', ids) : { data: [] }
      const t = new Map((totals ?? []).map((x) => [x.quote_id, x]))
      return ok((data ?? []).map((x) => ({ ...x, totals: t.get(x.id) ?? null, link: appUrl(`/quotes/${x.id}`) })))
    },
  )

  server.registerTool(
    'get_quote',
    {
      title: 'Get a quote',
      description: 'A quote with its line items and totals. Pass the id or number (e.g. Q-0012).',
      inputSchema: { quote: z.string().min(1) },
      annotations: readOnly,
    },
    async ({ quote }) => {
      const byId = /^[0-9a-f-]{36}$/i.test(quote.trim())
      const { data: q } = await admin.from('quotes').select('*').eq(byId ? 'id' : 'number', quote.trim()).maybeSingle()
      if (!q) return fail(`No quote ${quote}.`)
      const [items, totals] = await Promise.all([
        admin.from('quote_items').select('section, description, details, quantity, unit, unit_cost, markup_pct, unit_price').eq('quote_id', q.id).order('sort_order'),
        admin.from('quote_totals').select('*').eq('quote_id', q.id).maybeSingle(),
      ])
      return ok({ quote: q, items: items.data, totals: totals.data, link: appUrl(`/quotes/${q.id}`) })
    },
  )

  server.registerTool(
    'finance_summary',
    {
      title: 'Finance summary',
      description: 'Money in (payments received, incl. VAT), money out (expenses excl. VAT and VAT paid) and what clients still owe, for a date range. Defaults to this month so far.',
      inputSchema: { from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
      annotations: readOnly,
    },
    async ({ from, to }) => {
      const today = saToday()
      const start = from ?? `${today.slice(0, 8)}01`
      const end = to ?? today
      const [pay, exp, inv, paidAll] = await Promise.all([
        admin.from('payments').select('amount').gte('date', start).lte('date', end),
        admin.from('expenses').select('amount_excl, vat, category, project_id').gte('date', start).lte('date', end),
        admin.from('invoices').select('id, number, project_id, issue_date, due_date, amount_excl, vat, status').in('status', ['sent', 'overdue', 'paid']),
        admin.from('payments').select('invoice_id, amount').not('invoice_id', 'is', null),
      ])
      const received = round2((pay.data ?? []).reduce((s, r) => s + Number(r.amount), 0))
      const spentExcl = round2((exp.data ?? []).reduce((s, r) => s + Number(r.amount_excl), 0))
      const vatPaid = round2((exp.data ?? []).reduce((s, r) => s + Number(r.vat), 0))
      const byCat: Record<string, number> = {}
      for (const r of exp.data ?? []) byCat[r.category] = round2((byCat[r.category] ?? 0) + Number(r.amount_excl))
      const paidByInvoice = new Map<string, number>()
      for (const p of paidAll.data ?? []) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount))
      const owed = (inv.data ?? [])
        .map((i) => ({ number: i.number, due_date: i.due_date, outstanding: round2(Number(i.amount_excl) + Number(i.vat) - (paidByInvoice.get(i.id) ?? 0)) }))
        .filter((i) => i.outstanding > 0.005)
      return ok({
        period: { from: start, to: end },
        received_incl_vat: zar(received),
        expenses_excl_vat: zar(spentExcl),
        vat_on_expenses: zar(vatPaid),
        expenses_by_category: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, zar(v)])),
        owed_by_clients: { total: zar(round2(owed.reduce((s, i) => s + i.outstanding, 0))), invoices: owed },
      })
    },
  )

  server.registerTool(
    'list_unlinked_bank_lines',
    {
      title: 'Bank lines needing attention',
      description: 'Imported bank-statement lines not yet linked to an expense or payment (money out is negative).',
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      annotations: readOnly,
    },
    async ({ limit }) => {
      const { data, error } = await admin.from('bank_transactions').select('date, description, amount, reference, status').in('status', ['unmatched', 'suggested']).order('date', { ascending: false }).limit(limit ?? 50)
      if (error) return fail(error.message)
      return ok({ lines: data, link: appUrl('/bank') })
    },
  )

  // ---------- Changes ----------

  server.registerTool(
    'add_expense',
    {
      title: 'File an expense or slip',
      description:
        'Records a purchase against a project (or as a company overhead when no project is given). Give the slip total incl. VAT ' +
        '(VAT is worked out at 15% unless you pass vat), or amount_excl with vat. Optionally attach the slip image or PDF as base64 so it is kept with the expense.',
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Slip date, YYYY-MM-DD. Defaults to today.'),
        supplier: z.string().min(1),
        description: z.string().optional(),
        category: z.enum(CATEGORIES).describe('materials, labour, subcontractor, plant_hire, transport, permits, overheads or other'),
        project: z.string().optional().describe('Project id, code or name. Leave out for a company overhead.'),
        total_incl_vat: z.number().optional(),
        amount_excl: z.number().optional(),
        vat: z.number().optional().describe('VAT amount in rand. Pass 0 for a supplier that is not VAT-registered.'),
        receipt_number: z.string().optional(),
        paid: z.boolean().optional().describe('Defaults to true (already paid).'),
        slip_base64: z.string().optional().describe('The slip image or PDF, base64-encoded (max ~10 MB).'),
        slip_mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (a) => {
      if (!user.canWrite) return denyWrite()
      let projectId: string | null = null
      let projectLabel = 'company overhead'
      if (a.project) {
        const p = await findProject(admin, a.project)
        if (typeof p === 'string') return fail(p)
        projectId = p.id
        projectLabel = p.code ? `${p.name} (${p.code})` : p.name
      }
      const { data: settings } = await admin.from('company_settings').select('vat_rate, vat_registered').eq('id', true).maybeSingle()
      const rate = Number(settings?.vat_rate ?? 15)
      let excl: number
      let vat: number
      if (settings && settings.vat_registered === false) {
        // Not registered for VAT: it can't be claimed back, so the whole amount paid is the cost.
        const total = a.total_incl_vat ?? (a.amount_excl !== undefined ? a.amount_excl + (a.vat ?? (a.amount_excl * rate) / 100) : undefined)
        if (total === undefined) return fail('Give total_incl_vat (the slip total) or amount_excl.')
        excl = round2(total)
        vat = 0
      } else if (a.amount_excl !== undefined) {
        excl = round2(a.amount_excl)
        vat = round2(a.vat ?? (excl * rate) / 100)
      } else if (a.total_incl_vat !== undefined) {
        vat = round2(a.vat ?? a.total_incl_vat - a.total_incl_vat / (1 + rate / 100))
        excl = round2(a.total_incl_vat - vat)
      } else {
        return fail('Give total_incl_vat (the slip total) or amount_excl.')
      }
      if (excl < 0 || vat < 0) return fail('Amounts must not be negative.')

      let receiptPath: string | null = null
      if (a.slip_base64) {
        const buf = Buffer.from(a.slip_base64, 'base64')
        if (buf.length === 0) return fail('slip_base64 is not valid base64.')
        if (buf.length > 15 * 1024 * 1024) return fail('The slip file is larger than 15 MB.')
        const mime = a.slip_mime_type ?? 'image/jpeg'
        const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1]
        const today = saToday()
        receiptPath = `receipts/${today.slice(0, 4)}/${today.slice(5, 7)}/${randomUUID()}-claude.${ext}`
        const up = await admin.storage.from('receipts').upload(receiptPath, buf, { contentType: mime })
        if (up.error) return fail(`Could not store the slip: ${up.error.message}`)
      }

      const { data, error } = await admin
        .from('expenses')
        .insert({
          project_id: projectId,
          date: a.date ?? saToday(),
          category: a.category,
          supplier: a.supplier.trim(),
          description: a.description?.trim() || null,
          amount_excl: excl,
          vat,
          paid: a.paid ?? true,
          receipt_path: receiptPath,
          receipt_number: a.receipt_number?.trim() || null,
          source: receiptPath ? 'receipt' : 'manual',
          created_by: user.id,
        })
        .select('id')
        .single()
      if (error) {
        if (receiptPath) await admin.storage.from('receipts').remove([receiptPath])
        return fail(error.message)
      }
      return ok(`Filed ${a.supplier} ${zar(round2(excl + vat))} (excl. VAT ${zar(excl)}, VAT ${zar(vat)}) as ${a.category} on ${projectLabel}${receiptPath ? ', slip attached' : ''}. Expense id ${data.id}.`)
    },
  )

  server.registerTool(
    'create_quote_draft',
    {
      title: 'Draft a quote',
      description:
        'Creates a DRAFT quote with sections and line items. For each line give unit_price (selling price excl. VAT), or unit_cost with markup_pct. ' +
        'A person reviews and sends it from Remus. Use search_clients first to get the client id.',
      inputSchema: {
        title: z.string().min(1).describe('e.g. "Kitchen renovation"'),
        company_id: z.string().optional(),
        contact_id: z.string().optional().describe('A private client, or the contact person at the company'),
        site_address: z.string().optional(),
        notes: z.string().optional(),
        valid_days: z.number().int().min(1).max(365).optional().describe('Defaults to 30'),
        discount: z.number().min(0).optional().describe('Rand amount excl. VAT'),
        sections: z
          .array(
            z.object({
              name: z.string().optional().describe('Section heading, e.g. "Demolition"'),
              items: z
                .array(
                  z.object({
                    description: z.string().min(1),
                    kind: z.enum(['material', 'labour', 'subcontractor']).optional().describe('Kind of cost; labour is counted in days (unit "day")'),
                    details: z.string().optional().describe('What the line includes, shown under the description, e.g. "Remove old suite, supply and fit toilet, connect waste"'),
                    quantity: z.number().positive(),
                    unit: z.enum(UNITS).optional().describe('m², m³, m, each, hours, day or sum'),
                    unit_cost: z.number().min(0).optional().describe('Internal cost per unit'),
                    markup_pct: z.number().optional(),
                    unit_price: z.number().min(0).optional().describe('Selling price per unit excl. VAT'),
                  }),
                )
                .min(1),
            }),
          )
          .min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (a) => {
      if (!user.canWrite) return denyWrite()
      const { data: settings } = await admin.from('company_settings').select('vat_rate, vat_registered, quote_terms, management_fee_pct').eq('id', true).maybeSingle()
      const today = saToday()
      const valid = new Date(`${today}T12:00:00Z`)
      valid.setUTCDate(valid.getUTCDate() + (a.valid_days ?? 30))
      const lines = a.sections.flatMap((s) =>
        s.items.map((it) => {
          // As in the editor, the price is cost × markup. Given only a price, it becomes the cost at 0%.
          const onlyPrice = it.unit_cost === undefined && it.unit_price !== undefined
          const cost = round2(onlyPrice ? it.unit_price! : it.unit_cost ?? 0)
          const markup = onlyPrice
            ? 0
            : it.markup_pct ?? (cost && it.unit_price !== undefined ? round2((it.unit_price / cost - 1) * 100) : 0)
          const price = round2(cost * (1 + markup / 100))
          return { section: s.name?.trim() || null, description: it.description.trim(), details: it.details?.trim() || null, kind: it.kind ?? 'material', quantity: it.quantity, unit: it.unit ?? 'each', unit_cost: cost, markup_pct: markup, unit_price: price }
        }),
      )
      if (lines.some((l) => Math.abs(l.markup_pct) > 99999)) return fail('A markup is unrealistically large; check the cost and price.')
      const { data: q, error } = await admin
        .from('quotes')
        .insert({
          title: a.title.trim(),
          company_id: a.company_id ?? null,
          contact_id: a.contact_id ?? null,
          site_address: a.site_address ?? null,
          notes: a.notes ?? null,
          terms: settings?.quote_terms ?? null,
          vat_rate: settings?.vat_registered === false ? 0 : Number(settings?.vat_rate ?? 15),
          management_fee_pct: Number(settings?.management_fee_pct ?? 0),
          discount: a.discount ?? 0,
          issue_date: today,
          valid_until: valid.toISOString().slice(0, 10),
          status: 'draft',
          owner_id: user.id,
          created_by: user.id,
        })
        .select('id, number')
        .single()
      if (error) return fail(error.message)
      const ins = await admin.from('quote_items').insert(lines.map((l, i) => ({ ...l, quote_id: q.id, sort_order: i })))
      if (ins.error) {
        await admin.from('quotes').delete().eq('id', q.id)
        return fail(ins.error.message)
      }
      const { data: totals } = await admin.from('quote_totals').select('total_excl, vat, total_incl, estimated_cost').eq('quote_id', q.id).maybeSingle()
      return ok({ number: q.number, id: q.id, status: 'draft', totals, link: appUrl(`/quotes/${q.id}`) })
    },
  )

  server.registerTool(
    'add_site_diary_entry',
    {
      title: 'Add a site diary entry',
      description: "Records the day's site diary for a project: weather, workers on site, work done, deliveries, delays, safety. One entry per project per day; an existing entry for that day is updated.",
      inputSchema: {
        project: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        weather: z.string().optional(),
        workers_on_site: z.number().int().min(0).optional(),
        work_done: z.string().optional(),
        materials_delivered: z.string().optional(),
        delays: z.string().optional(),
        safety_notes: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ project, date, ...fields }) => {
      if (!user.canWrite) return denyWrite()
      const p = await findProject(admin, project)
      if (typeof p === 'string') return fail(p)
      const day = date ?? saToday()
      const values = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
      const { error } = await admin
        .from('site_diary_entries')
        .upsert({ project_id: p.id, date: day, ...values, created_by: user.id }, { onConflict: 'project_id,date' })
      if (error) return fail(error.message)
      return ok(`Site diary for ${p.name} on ${day} saved.`)
    },
  )

  server.registerTool(
    'add_diary_event',
    {
      title: 'Add a calendar event',
      description: 'Puts a site visit, meeting, inspection, delivery or quote appointment in the Remus diary. Times are South African time.',
      inputSchema: {
        title: z.string().min(1),
        start: z.string().describe('Local SA time, e.g. 2026-10-23T09:00'),
        end: z.string().optional(),
        all_day: z.boolean().optional(),
        type: z.enum(['site_visit', 'meeting', 'inspection', 'delivery', 'quote_appointment', 'other']).optional(),
        project: z.string().optional(),
        location: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (a) => {
      if (!user.canWrite) return denyWrite()
      // South Africa has no daylight saving: always UTC+2.
      const toIso = (s: string) => {
        const m = s.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/)
        if (!m) return null
        return new Date(`${m[1]}T${m[2] ?? '00'}:${m[3] ?? '00'}:00+02:00`).toISOString()
      }
      const start = toIso(a.start)
      const end = a.end ? toIso(a.end) : null
      if (!start) return fail('start must look like 2026-10-23T09:00.')
      if (end && end < start) return fail('end is before start.')
      let projectId: string | null = null
      if (a.project) {
        const p = await findProject(admin, a.project)
        if (typeof p === 'string') return fail(p)
        projectId = p.id
      }
      const { error } = await admin.from('diary_events').insert({
        title: a.title.trim(),
        start_at: start,
        end_at: end,
        all_day: a.all_day ?? false,
        type: a.type ?? 'other',
        project_id: projectId,
        location: a.location ?? null,
        notes: a.notes ?? null,
        owner_id: user.id,
        created_by: user.id,
      })
      if (error) return fail(error.message)
      return ok(`Added "${a.title}" to the diary.`)
    },
  )

  return server
}
