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
      if (String(url).includes('nominatim')) return new Response(JSON.stringify([{ lat: '-25.7697', lon: '28.2370', display_name: 'Brooklyn, Pretoria' }]))
      return new Response(JSON.stringify({ elements: [
        { lat: -25.7838, lon: 28.2766, tags: { name: 'Builders Menlyn' } },
        { center: { lat: -25.7700, lon: 28.2400 }, tags: { name: 'Cashbuild Brooklyn' } },
        { lat: -25.7700, lon: 28.2400, tags: { name: 'Cashbuild Brooklyn' } },
        { lat: -26.2, lon: 28.04, tags: { name: 'BUCO Johannesburg' } },
        { lat: -25.77, lon: 28.24, tags: { name: 'Woolworths' } },
      ] }))
    }) as unknown as typeof fetch
    const r = await nearbyStores([{ label: 'Site', address: 'Brooklyn, Pretoria', radiusKm: 5 }], fake)
    expect(r.problems).toEqual([])
    expect(r.branches.map((b) => b.name)).toEqual(['Cashbuild Brooklyn', 'Builders Menlyn'])
  })
  it('an address the map cannot find is said, not guessed', async () => {
    const fake = (async () => new Response('[]')) as unknown as typeof fetch
    const r = await nearbyStores([{ label: 'Site', address: 'Nowhere 99', radiusKm: 5 }], fake)
    expect(r.branches).toEqual([])
    expect(r.problems[0]).toMatch(/Could not find/)
  })
})
