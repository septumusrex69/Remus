import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { geocodeAny, nearbyStores, type Area, type MyStore } from '../_lib/nearbyStores.js'
import { autocomplete } from '../_lib/googlePlaces.js'
import { autocompleteFree } from '../_lib/photon.js'

/**
 * THE STORES NEAR A SITE, for Find prices' map (Remus · Handoff 1; the reasoning is in
 * api/_lib/nearbyStores.ts).
 *
 *   POST { areas: [{ label, address | lat+lon, radiusKm }], mine?: MyStore[] } -> { centres, branches, problems, source }
 *   POST { autocomplete: '42 Mack' } -> { suggestions: [{ text, placeId }] } -- Google with its key, free Photon without
 *   POST { geocode: 'address' } -> { lat, lon, found } | { error } -- saving one of My stores
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
  const typed = (req.body as { autocomplete?: unknown } | undefined)?.autocomplete ?? (probe ? req.query.autocomplete : undefined)
  if (typeof typed === 'string') {
    const key = process.env.GOOGLE_MAPS_API_KEY
    if (typed.trim().length < 3) return res.status(200).json({ suggestions: [], google: !!key })
    const words = typed.trim().slice(0, 120)
    try {
      return res.status(200).json({ suggestions: await (key ? autocomplete(words, key) : autocompleteFree(words)), google: !!key })
    } catch (e) {
      return res.status(200).json({ suggestions: [], google: !!key, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const toPlace = (req.body as { geocode?: unknown } | undefined)?.geocode ?? (probe ? req.query.geocode : undefined)
  if (typeof toPlace === 'string') {
    const g = toPlace.trim() ? await geocodeAny(toPlace.trim().slice(0, 200)) : null
    return g ? res.status(200).json(g) : res.status(200).json({ error: `Could not find "${toPlace}" on the map. Try the street, suburb and town.` })
  }
  const areas: Area[] = probe
    ? [{ label: 'Site', address: String(req.query.address ?? ''), radiusKm: Number(req.query.radius) || 5 }]
    : Array.isArray((req.body as { areas?: unknown })?.areas) ? ((req.body as { areas: Area[] }).areas) : []
  if (!areas.length) return res.status(400).json({ error: 'Give at least one address and radius.' })
  const mine = Array.isArray((req.body as { mine?: unknown } | undefined)?.mine) ? (req.body as { mine: MyStore[] }).mine : []
  return res.status(200).json(await nearbyStores(areas, mine))
}
