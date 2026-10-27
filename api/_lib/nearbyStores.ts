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
import { geocodeGoogle, searchChain } from './googlePlaces.js'

export interface Area { label: string; address?: string; lat?: number; lon?: number; radiusKm: number }
export interface Centre { label: string; lat: number; lon: number; radiusKm: number; found: string | null }
export interface Branch { store: string; storeName: string; name: string; lat: number; lon: number; distanceKm: number; nearest: string; address: string | null }

const UA = 'Remus/1.0 (Urban Haus construction quotes; urbanhausgroup.co.za)'
/* As each chain is searched for by name. */
const CHAIN_NAMES = ['Builders', 'Leroy Merlin', 'Cashbuild', 'BUCO', 'Plumblink', 'Build It']

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

export async function nearbyStores(areas: Area[], fetchImpl: typeof fetch = fetch, googleKey: string | undefined = process.env.GOOGLE_MAPS_API_KEY): Promise<{ centres: Centre[]; branches: Branch[]; problems: string[]; source: 'google' | 'openstreetmap' }> {
  // Google when its key is set (googlePlaces.ts), OpenStreetMap otherwise.
  const source = googleKey ? 'google' as const : 'openstreetmap' as const
  const problems: string[] = []
  const centres: Centre[] = []
  for (const a of areas.slice(0, 4)) {
    const radiusKm = Math.min(100, Math.max(1, Number(a.radiusKm) || 5))
    if (typeof a.lat === 'number' && typeof a.lon === 'number') { centres.push({ label: a.label, lat: a.lat, lon: a.lon, radiusKm, found: null }); continue }
    if (!a.address?.trim()) continue
    const g = await (googleKey ? geocodeGoogle(a.address, googleKey, fetchImpl) : geocode(a.address, fetchImpl)).catch(() => null)
    if (g) centres.push({ label: a.label, lat: g.lat, lon: g.lon, radiusKm, found: g.found })
    else problems.push(`Could not find "${a.address}" on the map. Try a suburb and town, e.g. "Brooklyn, Pretoria".`)
  }
  if (!centres.length) return { centres, branches: [], problems, source }

  /*
   * THE BRANCHES, FROM NOMINATIM'S NAME SEARCH inside the box around the areas. The first build asked
   * Overpass, OpenStreetMap's query service; on 27 Oct its three public servers answered 502 and timed
   * out from Remus's server, while Nominatim (the address look-up above) answered every time. So each
   * chain is searched by name inside the box, one after another -- Nominatim asks for no more than one
   * request a second -- and the distance check below keeps only what is inside a circle.
   */
  const pad = Math.max(...centres.map((c) => c.radiusKm)) / 111
  const box = [
    Math.min(...centres.map((c) => c.lon)) - pad, Math.max(...centres.map((c) => c.lat)) + pad,
    Math.max(...centres.map((c) => c.lon)) + pad, Math.min(...centres.map((c) => c.lat)) - pad,
  ].map((n) => n.toFixed(4)).join(',')
  let elements: { lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[] = []
  let failed = 0
  if (googleKey) {
    // Google: the six chains at once (no one-a-second rule), each held to the box.
    const [west, north, east, south] = box.split(',').map(Number)
    const found = await Promise.allSettled(CHAIN_NAMES.map((chain) => searchChain(chain, { south, west, north, east }, googleKey, fetchImpl)))
    found.forEach((f, i) => {
      if (f.status === 'rejected') { failed++; return }
      // Matched on the place's OWN name: a text search for "Builders" also returns building contractors.
      void i
      for (const p of f.value) elements.push({ lat: p.lat, lon: p.lon, tags: { name: p.name, 'addr:street': p.address ?? '' } })
    })
  }
  for (const [i, chain] of (googleKey ? [] : CHAIN_NAMES).entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1100))
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=30&countrycodes=za&bounded=1&addressdetails=1&viewbox=${box}&q=${encodeURIComponent(chain)}`
      const r = await fetchImpl(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, signal: AbortSignal.timeout(8_000) })
      if (!r.ok) { failed++; continue }
      const rows = (await r.json()) as { lat: string; lon: string; name?: string; display_name: string; address?: Record<string, string> }[]
      for (const row of rows) {
        const ad = row.address ?? {}
        elements.push({
          lat: Number(row.lat), lon: Number(row.lon),
          tags: {
            name: row.name || row.display_name.split(',')[0], brand: chain,
            'addr:housenumber': ad.house_number ?? '', 'addr:street': ad.road ?? '',
            'addr:suburb': ad.suburb ?? ad.neighbourhood ?? '', 'addr:city': ad.city ?? ad.town ?? '',
          },
        })
      }
    } catch {
      failed++
    }
  }
  if (failed === CHAIN_NAMES.length) problems.push("The map's store directory did not answer; try again in a minute.")
  else if (failed) problems.push(`${failed} of the ${CHAIN_NAMES.length} stores could not be looked up on the map just now.`)
  elements = elements.filter((e) => storeOf(e.tags ?? {}))

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
  return { centres, branches, problems, source }
}
