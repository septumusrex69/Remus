import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { requireCaller, supabaseEnv } from '../_lib/auth.js'
import { recordUsage, usdFor } from '../_lib/aiUsage.js'
import { mediaTypeFor, readSlip, slipForClaude, SLIP_MODEL } from '../_lib/slipReader.js'
import { BASELINE_MODEL, readSlipBaseline } from '../_lib/slipReaderBaseline.js'

/**
 * THE SIDE-BY-SIDE TEST (Remus · Handover 7). POST { path, label? }: reads one stored slip with the first reader
 * (Sonnet, the photo as stored, the project list) and the new one (Haiku, the shrunk copy), at the same time, and
 * keeps both answers with their tokens, cost and time in slip_reader_trials. Administrators only; /slip-test calls it.
 * Delete with api/_lib/slipReaderBaseline.ts once Stephan has decided.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  if (!supabaseEnv()) { res.status(500).json({ error: 'Server is missing Supabase configuration.' }); return }
  const caller = await requireCaller(req)
  if (!caller) { res.status(401).json({ error: 'Invalid or expired session.' }); return }
  const { db, user } = caller
  const { data: me } = await db.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
  if (me?.role !== 'Administrator' || me?.status !== 'Active') { res.status(403).json({ error: 'Only an Administrator can run the slip test.' }); return }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(200).json({ error: 'ANTHROPIC_API_KEY is not set here.' }); return }

  const { path, label } = (req.body ?? {}) as { path?: unknown; label?: unknown }
  if (typeof path !== 'string' || !path.startsWith('receipts/') || path.includes('..')) { res.status(400).json({ error: 'A receipts/ storage path is required.' }); return }

  const download = await db.storage.from('receipts').download(path)
  if (download.error || !download.data) { res.status(404).json({ error: 'Slip not found.' }); return }
  const bytes = Buffer.from(await download.data.arrayBuffer())
  const mediaType = mediaTypeFor(path, download.data.type)
  const file = await slipForClaude(bytes, mediaType)
  if (!file) { res.status(200).json({ error: "Couldn't open this file." }); return }

  const client = new Anthropic()
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e))
  const [oldRead, newRead] = await Promise.all([
    readSlipBaseline(db, user.id, bytes, mediaType).catch((e) => ({ ok: false as const, reason: why(e), usage: { inputTokens: 0, outputTokens: 0 }, ms: 0 })),
    readSlip(client, file).catch((e) => ({ ok: false as const, reason: why(e), usage: { inputTokens: 0, outputTokens: 0 }, ms: 0 })),
  ])
  const note = `trial ${path}`
  await Promise.all([
    recordUsage(db, user.id, { feature: 'slip_reader', model: BASELINE_MODEL, inputTokens: oldRead.usage.inputTokens, outputTokens: oldRead.usage.outputTokens, note }),
    recordUsage(db, user.id, { feature: 'slip_reader', model: SLIP_MODEL, inputTokens: newRead.usage.inputTokens, outputTokens: newRead.usage.outputTokens, note }),
  ])

  const row = {
    path,
    label: typeof label === 'string' ? label.slice(0, 120) : null,
    bytes_in: bytes.length,
    bytes_sent: file.data.length,
    sent_width: file.shrunk?.width ?? null,
    sent_height: file.shrunk?.height ?? null,
    old_model: BASELINE_MODEL,
    old_result: oldRead.ok ? { extraction: oldRead.extraction, suggestion: oldRead.suggestion } : { error: oldRead.reason },
    old_input_tokens: oldRead.usage.inputTokens,
    old_output_tokens: oldRead.usage.outputTokens,
    old_usd: usdFor(BASELINE_MODEL, oldRead.usage.inputTokens, oldRead.usage.outputTokens),
    old_ms: oldRead.ms,
    new_model: SLIP_MODEL,
    new_result: newRead.ok ? { extraction: newRead.extraction } : { error: newRead.reason },
    new_input_tokens: newRead.usage.inputTokens,
    new_output_tokens: newRead.usage.outputTokens,
    new_usd: usdFor(SLIP_MODEL, newRead.usage.inputTokens, newRead.usage.outputTokens),
    new_ms: newRead.ms,
  }
  const { data, error } = await db.from('slip_reader_trials').insert(row).select('*').single()
  if (error) { res.status(200).json({ error: `Read both ways but could not keep the result: ${error.message}`, trial: row }); return }
  res.status(200).json({ trial: data })
}
