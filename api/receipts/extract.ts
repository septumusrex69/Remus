import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { requireCaller, supabaseEnv } from '../_lib/auth.js'
import { recordUsage } from '../_lib/aiUsage.js'
import { IMAGE_TYPES, MAX_BYTES, mediaTypeFor, readSlip, slipForClaude, SLIP_MODEL } from '../_lib/slipReader.js'

/**
 * Reads a slip photo/PDF with Claude: supplier, date, slip number, total, VAT, line items. Nothing else.
 *
 * POST { path } where path is an object in the private 'receipts' bucket.
 * Remus · Handover 7: Claude no longer guesses the project (Stephan: "Just ask which project is it for"), the photo
 * is shrunk before it is sent and the photo in Storage is left as it was. Why, and the numbers: api/_lib/slipReader.ts.
 * The caller's Supabase JWT is verified before anything else; the file is read *as that user* (RLS applies).
 *
 * AI is optional: without ANTHROPIC_API_KEY this returns 200 { configured: false, message } and the
 * app falls back to manual entry. Any failure talking to Claude degrades the same way.
 */

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
    res.status(200).json({ configured: false, message: 'This file is too large for automatic reading (over 10 MB). Fill in the details by hand.' })
    return
  }
  if (mediaType !== 'application/pdf' && !IMAGE_TYPES.includes(mediaType as (typeof IMAGE_TYPES)[number]) && mediaType !== 'image/heic') {
    res.status(200).json({ configured: false, message: `Can't read ${mediaType} files automatically (try JPEG or PNG). Fill in the details by hand.` })
    return
  }
  const file = await slipForClaude(bytes, mediaType)
  if (!file) {
    res.status(200).json({ configured: false, message: "Couldn't open this file for reading. Fill in the details by hand." })
    return
  }

  try {
    const read = await readSlip(new Anthropic(), file)
    // Every read is paid for, read well or not. The slip's path is the note, so a read can be matched to its expense.
    await recordUsage(db, user.id, { feature: 'slip_reader', model: SLIP_MODEL, inputTokens: read.usage.inputTokens, outputTokens: read.usage.outputTokens, note: path })
    if (!read.ok) {
      if (read.reason === 'max_tokens') console.error('Slip extraction hit max_tokens')
      const message = read.reason === 'max_tokens'
        ? 'This slip was too long to read automatically. Fill in the details by hand.'
        : "Couldn't read this slip automatically. Fill in the details by hand."
      res.status(200).json({ configured: false, message })
      return
    }
    res.status(200).json({ configured: true, extraction: read.extraction, suggestion: null })
  } catch (error) {
    let message = 'Slip reading failed. Fill in the details by hand.'
    if (error instanceof Anthropic.AuthenticationError) message = 'The AI key is invalid. Fill in the details by hand.'
    else if (error instanceof Anthropic.RateLimitError) message = 'Slip reading is busy right now. Fill in the details by hand.'
    else if (error instanceof Anthropic.APIError) console.error('Claude API error', error.status, error.message)
    else console.error('Slip extraction failed', error)
    res.status(200).json({ configured: false, message })
  }
}
