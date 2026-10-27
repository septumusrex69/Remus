/**
 * WHICH BRANCHES ARE NEAR THE SITE (Remus · Handoff 1, 27 Oct 2026). Stephan: "for the quotes ... where
 * you're looking and what's the radius ... integrate Google Maps or an address", "unless you include
 * delivery, because delivery can come from anywhere".
 *
 * OPENSTREETMAP, NOT GOOGLE, to start: free and keyless. An address becomes a point through Nominatim;
 * the stores' branches come from the Overpass service (shops tagged with the chain's name or brand)
 * within each area's radius. Where OpenStreetMap misses a branch, Google Places is the upgrade -- it needs
 * a key and is paid past a monthly allowance, so it waits until the free map is shown to fall short.
 *
 * Both services ask for a named User-Agent and light use; Find prices calls them once per press.
 */
import { STORES } from './priceCrawl.js'

export interface Area { label: string; address?: string; lat?: number; lon?: number; radiusKm: number }
export interface Centre { label: string; lat: number; lon: number; radiusKm: number; found: string | null }
export interface Branch { store: string; storeName: string; name: string; lat: number; lon: number; distanceKm: number; nearest: string; address: string | null }

const UA = 'Remus/1.0 (Urban Haus construction quotes; urbanhausgroup.co.za)'
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']

/* How each chain is written on OpenStreetMap (name or brand); matched without case. */
const CHAIN_PATTERNS: Record<string, RegExp> = {
  builders: /^builders\b|builders (warehouse|express|superstore)/i,
  leroymerlin: /leroy\s*merlin/i,
  cashbuild: /cashbuild/i,
  buco: /\bbuco\b/i,
  plumblink: /plumblink/i,
  buildit: /build\s*-?\s*it/i,
}

export function storeOf(tags: Record<string, string>): string | null {
  const text = [tags.brand, tags.name, tags['brand:en']].filter(Boolean).join(' | ')
  for (const [id, re] of Object.entries(CHAIN_PATTERNS)) if (re.test(text)) return id
  return null
}

/** Great-circle distance in km. */
export function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  const dLat = r(bLat - aLat)
  const dLon = r(bLon - aLon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLon / 2) ** 2
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(h)) * 10) / 10
}

async function geocode(address: string, fetchImpl: typeof fetch): Promise<{ lat: number; lon: number; found: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=za&q=${encodeURIComponent(address)}`
  const r = await fetchImpl(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: AbortSignal.timeout(10_000) })
  if (!r.ok) return null
  const rows = (await r.json()) as { lat: string; lon: string; display_name: string }[]
  return rows[0] ? { lat: Number(rows[0].lat), lon: Number(rows[0].lon), found: rows[0].display_name } : null
}

export async function nearbyStores(areas: Area[], fetchImpl: typeof fetch = fetch): Promise<{ centres: Centre[]; branches: Branch[]; problems: string[] }> {
  const problems: string[] = []
  const centres: Centre[] = []
  for (const a of areas.slice(0, 4)) {
    const radiusKm = Math.min(100, Math.max(1, Number(a.radiusKm) || 5))
    if (typeof a.lat === 'number' && typeof a.lon === 'number') { centres.push({ label: a.label, lat: a.lat, lon: a.lon, radiusKm, found: null }); continue }
    if (!a.address?.trim()) continue
    const g = await geocode(a.address, fetchImpl).catch(() => null)
    if (g) centres.push({ label: a.label, lat: g.lat, lon: g.lon, radiusKm, found: g.found })
    else problems.push(`Could not find "${a.address}" on the map. Try a suburb and town, e.g. "Brooklyn, Pretoria".`)
  }
  if (!centres.length) return { centres, branches: [], problems }

  const chains = 'Builders|Leroy Merlin|Cashbuild|BUCO|Buco|Plumblink|Build It|Build-It'
  const around = centres.map((c) => `nwr["shop"](around:${Math.round(c.radiusKm * 1000)},${c.lat},${c.lon})["name"~"${chains}",i];nwr["shop"](around:${Math.round(c.radiusKm * 1000)},${c.lat},${c.lon})["brand"~"${chains}",i];`).join('')
  const ql = `[out:json][timeout:15];(${around});out center 300;`
  let elements: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] = []
  /*
   * Overpass is run by volunteers on a few public servers; the main one is often busy. Try them in
   * turn, and keep what each said, so a failure says why rather than only "did not answer".
   */
  const tried: string[] = []
  const ask = async (endpoint: string) => {
    try {
      const r = await fetchImpl(endpoint, {
        method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: `data=${encodeURIComponent(ql)}`, signal: AbortSignal.timeout(18_000),
      })
      const text = await r.text()
      if (!r.ok) throw new Error(String(r.status))
      return (JSON.parse(text) as { elements?: typeof elements }).elements ?? []
    } catch (e) {
      tried.push(`${new URL(endpoint).host}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160))
      throw e
    }
  }
  // All three at once; the first good answer wins (one after another took over a minute when busy).
  try { elements = await Promise.any(OVERPASS.map(ask)) } catch { /* every one failed; said below */ }
  if (elements.length) tried.length = 0
  if (tried.length) problems.push(`The map's store directory did not answer; try again in a minute. (${tried.join('; ')})`)

  const seen = new Set<string>()
  const branches: Branch[] = []
  for (const e of elements) {
    const tags = e.tags ?? {}
    const store = storeOf(tags)
    const lat = e.lat ?? e.center?.lat
    const lon = e.lon ?? e.center?.lon
    if (!store || lat == null || lon == null) continue
    const near = centres.map((c) => ({ c, d: km(c.lat, c.lon, lat, lon) })).sort((a, b) => a.d - b.d)[0]
    if (near.d > near.c.radiusKm + 0.5) continue
    const key = `${store}|${lat.toFixed(3)}|${lon.toFixed(3)}`
    if (seen.has(key)) continue
    seen.add(key)
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
    branches.push({
      store, storeName: STORES.find((s) => s.id === store)?.name ?? store,
      name: tags.name ?? tags.brand ?? store, lat, lon, distanceKm: near.d, nearest: near.c.label,
      address: [street, tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', ') || null,
    })
  }
  branches.sort((a, b) => a.distanceKm - b.distanceKm)
  return { centres, branches, problems }
}
