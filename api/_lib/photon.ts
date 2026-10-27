/**
 * ADDRESSES AS THEY ARE TYPED, FREE (Remus · Handoff 1, 27 Oct 2026). Stephan, of the Google key:
 * "Isn't there any cheaper way to do this?" Photon (photon.komoot.io) is an address search built on
 * OpenStreetMap -- the same map the quote's map already draws -- with no key, no card and no bill. It
 * is a little thinner than Google on small streets; Google's autocomplete (googlePlaces.ts) still takes
 * over if GOOGLE_MAPS_API_KEY is ever set.
 *
 * Held to South Africa by a box, and leaned towards Pretoria, where Urban Haus works, so "Brooklyn"
 * means Brooklyn, Pretoria before Brooklyn, Cape Town.
 */
import type { Suggestion } from './googlePlaces.js'

const UA = 'Remus/1.0 (Urban Haus construction quotes; urbanhausgroup.co.za)'
const SOUTH_AFRICA = '16.3,-34.9,32.95,-22.1'
const PRETORIA = { lat: -25.75, lon: 28.23 }

interface Feature { properties: Record<string, string | number | undefined> }

/** "42 Mackenzie Street, Brooklyn, Pretoria, 0181" out of Photon's parts, skipping what is missing. */
export function photonText(p: Feature['properties']): string {
  const street = p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : null
  const first = p.name && p.name !== p.street ? String(p.name) : null
  // Municipal wards ("Tshwane Ward 56") are how the map files a street, not how anybody writes one.
  const place = [p.locality, p.district].find((x) => x != null && !/\bward\b/i.test(String(x)))
  const parts = [first, street, place, p.city ?? p.county, p.postcode]
    .filter((x): x is string | number => x != null && String(x).trim() !== '')
    .map(String)
  return parts.filter((x, i) => parts.indexOf(x) === i).join(', ')
}

export async function autocompleteFree(input: string, fetchImpl: typeof fetch = fetch): Promise<Suggestion[]> {
  const url = `https://photon.komoot.io/api/?limit=8&lang=en&bbox=${SOUTH_AFRICA}&lat=${PRETORIA.lat}&lon=${PRETORIA.lon}&q=${encodeURIComponent(input)}`
  const r = await fetchImpl(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6_000) })
  if (!r.ok) throw new Error(`The address search answered ${r.status}`)
  const body = (await r.json()) as { features?: (Feature & { properties: { osm_id?: number; countrycode?: string } })[] }
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const f of body.features ?? []) {
    if (f.properties.countrycode && f.properties.countrycode !== 'ZA') continue
    const text = photonText(f.properties)
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push({ text, placeId: `osm:${f.properties.osm_id ?? text}` })
  }
  return out.slice(0, 6)
}
