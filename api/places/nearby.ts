import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { nearbyStores, type Area } from '../_lib/nearbyStores.js'

/**
 * THE STORES NEAR A SITE, for Find prices' map (Remus · Handoff 1; the reasoning is in
 * api/_lib/nearbyStores.ts).
 *
 *   POST { areas: [{ label, address | lat+lon, radiusKm }] } -> { centres, branches, problems }
 *
 * Signed-in people, or the build session's preview-only test key (PRICE_PROBE_KEY, as api/prices/search
 * takes it) with GET ?address=...&radius=5.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const key = process.env.PRICE_PROBE_KEY
  const probe = req.method === 'GET' && !!key && key.length >= 16 && req.query.key === key
  if (!probe) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
    if (!(await requireCaller(req))) return res.status(401).json({ error: 'Sign in again.' })
  }
  const areas: Area[] = probe
    ? [{ label: 'Site', address: String(req.query.address ?? ''), radiusKm: Number(req.query.radius) || 5 }]
    : Array.isArray((req.body as { areas?: unknown })?.areas) ? ((req.body as { areas: Area[] }).areas) : []
  if (!areas.length) return res.status(400).json({ error: 'Give at least one address and radius.' })
  return res.status(200).json(await nearbyStores(areas))
}
