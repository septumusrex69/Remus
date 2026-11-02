import type Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'

/**
 * THE SLIP READER, CHEAP (Remus · Handover 7, 2 Nov 2026). Stephan: slip reading was "heading to about R1,000 a
 * month ... the budget is a fraction of that. Keep accuracy the same." And: "I don't think it's necessary to try to
 * find out which project it is for ... Just ask which project is it for."
 *
 * What changed from the first reader (Sonnet, a colour photo up to 2000px, every project and stage and the last 40
 * expenses in the prompt -- about 15,000 tokens a slip, R0.65):
 *   - Claude only READS the slip. No project list, no suggestion: the screen asks which project it is for.
 *   - The photo is shrunk on the server first (readingSize below), greyscale, turned upright from its EXIF, JPEG 75.
 *     Only that copy goes to Claude; the photo in Storage stays as it was uploaded, for audit.
 *   - Claude Haiku 5.5 at low effort, a short prompt, strict JSON, a low output cap.
 * About 2,000 tokens a slip, R0.01. The side-by-side test against the first reader is /slip-test.
 */

export const SLIP_MODEL = 'claude-haiku-5-5'
/** Enough for a long till slip's line items; a read that runs out falls back to the form by hand. */
export const SLIP_MAX_TOKENS = 1500

/** The long side of a normal slip photo, in pixels. */
export const READ_EDGE = 1200
/** A long, narrow till slip keeps this many pixels in all (1200 x 1200) instead, up to READ_EDGE_LONG tall. */
const READ_AREA = READ_EDGE * READ_EDGE
const READ_EDGE_LONG = 2400
/** Long side over short side above which a slip counts as a long till slip. */
const LONG_SLIP_RATIO = 2

/**
 * The size a slip photo is shrunk to before Claude reads it. Never bigger than it was.
 * A normal photo: the long side at most 1200px. A long till slip (more than twice as long as it is wide): squeezing
 * its long side to 1200px would leave it a few hundred pixels wide and the print unreadable, so it keeps up to
 * 1200 x 1200 pixels' worth of area instead, at most 2400px long. Claude charges by pixel count, so this costs the
 * same as a 1200 x 1200 photo at most.
 */
export function readingSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (!(long > 0 && short > 0)) return { width, height }
  const scale = long / short > LONG_SLIP_RATIO
    ? Math.min(1, Math.sqrt(READ_AREA / (width * height)), READ_EDGE_LONG / long)
    : Math.min(1, READ_EDGE / long)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export interface ShrunkSlip {
  data: Buffer
  mediaType: 'image/jpeg'
  width: number
  height: number
  /** Bytes of the photo as stored, and of the copy that goes to Claude. */
  bytesIn: number
  bytesOut: number
}

/** The copy of a slip photo that Claude reads: upright (EXIF), greyscale, shrunk (readingSize), JPEG 75. */
export async function shrinkForReading(bytes: Buffer): Promise<ShrunkSlip> {
  const upright = sharp(bytes, { failOn: 'none' }).rotate()
  const { data: raw, info } = await upright.toBuffer({ resolveWithObject: true })
  const size = readingSize(info.width, info.height)
  const out = await sharp(raw, { failOn: 'none' })
    .resize({ width: size.width, height: size.height, fit: 'fill', withoutEnlargement: true })
    .greyscale()
    .toColourspace('b-w')
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer({ resolveWithObject: true })
  return { data: out.data, mediaType: 'image/jpeg', width: out.info.width, height: out.info.height, bytesIn: bytes.length, bytesOut: out.data.length }
}

// anyOf rather than `type: [X, 'null']`: the form structured outputs supports for nullable fields.
const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })

/** Only what the expense needs: supplier, date, slip number, total, VAT, and the items (for the products book). */
export const SLIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'date', 'slip_number', 'total_incl', 'vat', 'line_items'],
  properties: {
    supplier: nullable('string'),
    date: { ...nullable('string'), description: 'YYYY-MM-DD' },
    slip_number: nullable('string'),
    total_incl: { ...nullable('number'), description: 'Total paid incl. VAT' },
    vat: nullable('number'),
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
} as const

export const SLIP_SYSTEM = `Read this South African till slip or supplier invoice. Amounts are in rand. Return the store's trading name, the date (YYYY-MM-DD), the slip/invoice number, the total paid incl. VAT, the VAT amount if printed, and each line item (description, quantity, line amount). Use null for anything you cannot read clearly; never guess digits.`

export interface SlipExtraction {
  supplier: string | null
  date: string | null
  slip_number: string | null
  total_incl: number | null
  vat: number | null
  line_items: { description: string; quantity: number | null; amount: number | null }[]
}

export type SlipRead =
  | { ok: true; extraction: SlipExtraction; usage: { inputTokens: number; outputTokens: number }; ms: number }
  | { ok: false; reason: 'refusal' | 'max_tokens' | 'empty'; usage: { inputTokens: number; outputTokens: number }; ms: number }

/** A real calendar date in YYYY-MM-DD form. */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** Tidies what Claude returned: a bad date becomes null, numbers stay numbers, items keep a description. */
export function cleanExtraction(x: Partial<SlipExtraction> | null | undefined): SlipExtraction {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null)
  return {
    supplier: str(x?.supplier),
    date: isYmd(x?.date) ? x!.date! : null,
    slip_number: str(x?.slip_number),
    total_incl: num(x?.total_incl),
    vat: num(x?.vat),
    line_items: (Array.isArray(x?.line_items) ? x!.line_items! : [])
      .filter((l) => l && typeof l.description === 'string' && l.description.trim())
      .map((l) => ({ description: l.description.trim().slice(0, 200), quantity: num(l.quantity), amount: num(l.amount) })),
  }
}

/** Reads one slip with Haiku. `file` is the shrunk photo, or a PDF as it was uploaded. */
export async function readSlip(client: Anthropic, file: { data: Buffer; mediaType: string }): Promise<SlipRead> {
  const started = Date.now()
  const block: Anthropic.ContentBlockParam = file.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data.toString('base64') } }
    : { type: 'image', source: { type: 'base64', media_type: file.mediaType as 'image/jpeg', data: file.data.toString('base64') } }
  const response = await client.messages.create({
    model: SLIP_MODEL,
    max_tokens: SLIP_MAX_TOKENS,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SLIP_SCHEMA } },
    system: SLIP_SYSTEM,
    messages: [{ role: 'user', content: [block] }],
  })
  const u = response.usage
  const usage = {
    inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens,
  }
  const ms = Date.now() - started
  if (response.stop_reason === 'refusal') return { ok: false, reason: 'refusal', usage, ms }
  if (response.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', usage, ms }
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text
  if (!text) return { ok: false, reason: 'empty', usage, ms }
  return { ok: true, extraction: cleanExtraction(JSON.parse(text) as Partial<SlipExtraction>), usage, ms }
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
/** Claude's per-image limit, for the photo as stored (the copy sent is far smaller). */
export const MAX_BYTES = 10 * 1024 * 1024

export function mediaTypeFor(path: string, blobType: string): string {
  if (blobType && blobType !== 'application/octet-stream') return blobType
  const ext = path.split('.').pop()?.toLowerCase()
  return ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'heic' ? 'image/heic' : 'image/jpeg'
}

/** The file Claude reads for a stored slip: a photo shrunk, a PDF as it is. Null when it can't be read. */
export async function slipForClaude(bytes: Buffer, mediaType: string): Promise<{ data: Buffer; mediaType: string; shrunk: ShrunkSlip | null } | null> {
  if (mediaType === 'application/pdf') return bytes.length <= 32 * 1024 * 1024 ? { data: bytes, mediaType, shrunk: null } : null
  // sharp reads HEIC too where libvips has it; anything it can't open is not read.
  try {
    const shrunk = await shrinkForReading(bytes)
    return { data: shrunk.data, mediaType: shrunk.mediaType, shrunk }
  } catch {
    return null
  }
}
