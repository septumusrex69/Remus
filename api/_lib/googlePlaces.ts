/**
 * GOOGLE, FOR ADDRESSES AND BRANCHES (Remus · Handoff 1, 27 Oct 2026). Stephan, after the free map:
 * "It didn't even pick up the address. I think it should be linked with Google Maps."
 *
 * Used whenever GOOGLE_MAPS_API_KEY is set in Vercel; without it Remus keeps to OpenStreetMap
 * (nearbyStores.ts). The key lives on the server only -- every call to Google goes through Remus's own
 * api/places/nearby -- so it is never in the browser's code (CLAUDE.md, Raptor's rule for API keys).
 *
 *   autocomplete  -- Places API (New) Autocomplete: addresses as they are typed, South Africa only.
 *   geocode       -- Geocoding API: an address to a point.
 *   searchChain   -- Places API (New) Text Search: one chain's branches inside a box.
 *
 * Each is one request; the field masks ask only for what Remus reads, which is what Google bills on.
 */

export interface Suggestion { text: string; placeId: string }

export async function autocomplete(input: string, key: string, fetchImpl: typeof fetch = fetch): Promise<Suggestion[]> {
  const r = await fetchImpl('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ input, includedRegionCodes: ['za'], languageCode: 'en' }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!r.ok) throw new Error(`Google address search answered ${r.status}`)
  const body = (await r.json()) as { suggestions?: { placePrediction?: { placeId: string; text?: { text: string } } }[] }
  return (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is { placeId: string; text: { text: string } } => !!p?.text?.text)
    .map((p) => ({ text: p.text.text, placeId: p.placeId }))
    .slice(0, 6)
}

export async function geocodeGoogle(address: string, key: string, fetchImpl: typeof fetch = fetch): Promise<{ lat: number; lon: number; found: string } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?region=za&components=country:ZA&address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) })
  if (!r.ok) return null
  const body = (await r.json()) as { status: string; results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[] }
  const hit = body.results?.[0]
  return body.status === 'OK' && hit ? { lat: hit.geometry.location.lat, lon: hit.geometry.location.lng, found: hit.formatted_address } : null
}

export interface GooglePlace { name: string; address: string | null; lat: number; lon: number }

/** One chain's places inside the box (south-west / north-east corners). */
export async function searchChain(chain: string, box: { south: number; west: number; north: number; east: number }, key: string, fetchImpl: typeof fetch = fetch): Promise<GooglePlace[]> {
  const r = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': 'places.displayName,places.formattedAddress,places.location' },
    body: JSON.stringify({
      textQuery: chain, regionCode: 'ZA', pageSize: 20,
      locationRestriction: { rectangle: { low: { latitude: box.south, longitude: box.west }, high: { latitude: box.north, longitude: box.east } } },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) throw new Error(`Google store search answered ${r.status}`)
  const body = (await r.json()) as { places?: { displayName?: { text: string }; formattedAddress?: string; location?: { latitude: number; longitude: number } }[] }
  return (body.places ?? [])
    .filter((p) => p.location && p.displayName?.text)
    .map((p) => ({ name: p.displayName!.text, address: p.formattedAddress ?? null, lat: p.location!.latitude, lon: p.location!.longitude }))
}
