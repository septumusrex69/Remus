import { describe, expect, it } from 'vitest'
import { km, nearbyStores, storeOf } from './nearbyStores.js'

describe('the stores near a site', () => {
  it('knows the chains however OpenStreetMap writes them', () => {
    expect(storeOf({ name: 'Builders Warehouse Menlyn' })).toBe('builders')
    expect(storeOf({ brand: 'Leroy Merlin', name: 'Leroy Merlin Silver Lakes' })).toBe('leroymerlin')
    expect(storeOf({ name: 'Cashbuild Pretoria West' })).toBe('cashbuild')
    expect(storeOf({ name: 'BUCO Centurion' })).toBe('buco')
    expect(storeOf({ name: 'Build It Hatfield' })).toBe('buildit')
    expect(storeOf({ name: 'Spar' })).toBeNull()
  })
  it('measures distance in km', () => {
    // Brooklyn Mall to Menlyn Park, Pretoria: about 4 km.
    expect(km(-25.7697, 28.2370, -25.7838, 28.2766)).toBeGreaterThan(3.5)
    expect(km(-25.7697, 28.2370, -25.7838, 28.2766)).toBeLessThan(4.6)
  })
  it('keeps only branches inside a radius, nearest first, each named once', async () => {
    const fake = (async (url: string) => {
      const u = new URL(String(url))
      const q = u.searchParams.get('q')
      if (!u.searchParams.get('viewbox')) return new Response(JSON.stringify([{ lat: '-25.7697', lon: '28.2370', display_name: 'Brooklyn, Pretoria' }]))
      const rows: Record<string, object[]> = {
        Builders: [{ lat: '-25.7838', lon: '28.2766', name: 'Builders Menlyn', display_name: 'Builders Menlyn, Pretoria' }],
        Cashbuild: [
          { lat: '-25.7700', lon: '28.2400', name: 'Cashbuild Brooklyn', display_name: 'Cashbuild Brooklyn' },
          { lat: '-25.7700', lon: '28.2400', name: 'Cashbuild Brooklyn', display_name: 'Cashbuild Brooklyn' },
        ],
        BUCO: [{ lat: '-26.2', lon: '28.04', name: 'BUCO Johannesburg', display_name: 'BUCO Johannesburg' }],
      }
      return new Response(JSON.stringify(rows[q ?? ''] ?? []))
    }) as unknown as typeof fetch
    const r = await nearbyStores([{ label: 'Site', address: 'Brooklyn, Pretoria', radiusKm: 5 }], fake)
    expect(r.problems).toEqual([])
    expect(r.branches.map((b) => b.name)).toEqual(['Cashbuild Brooklyn', 'Builders Menlyn'])
  }, 15_000)
  it('an address the map cannot find is said, not guessed', async () => {
    const fake = (async () => new Response('[]')) as unknown as typeof fetch
    const r = await nearbyStores([{ label: 'Site', address: 'Nowhere 99', radiusKm: 5 }], fake)
    expect(r.branches).toEqual([])
    expect(r.problems[0]).toMatch(/Could not find/)
  })
})
