import { describe, expect, it } from 'vitest'
import { autocompleteFree, photonText } from './photon.js'

describe('free address suggestions (Photon)', () => {
  it('writes an address the way a person does, skipping what is missing', () => {
    expect(photonText({ housenumber: '42', street: 'Mackenzie Street', district: 'Brooklyn', city: 'Pretoria', postcode: '0181' }))
      .toBe('42 Mackenzie Street, Brooklyn, Pretoria, 0181')
    expect(photonText({ name: 'Brooklyn', city: 'Pretoria' })).toBe('Brooklyn, Pretoria')
    expect(photonText({ street: 'Mackenzie Street', district: 'Tshwane Ward 56', city: 'Pretoria', postcode: '0181' })).toBe('Mackenzie Street, Pretoria, 0181')
  })
  it('keeps South Africa only and never repeats a line', async () => {
    const fake = (async () => new Response(JSON.stringify({ features: [
      { properties: { osm_id: 1, countrycode: 'ZA', name: 'Brooklyn', city: 'Pretoria' } },
      { properties: { osm_id: 2, countrycode: 'ZA', name: 'Brooklyn', city: 'Pretoria' } },
      { properties: { osm_id: 3, countrycode: 'US', name: 'Brooklyn', city: 'New York' } },
    ] }))) as unknown as typeof fetch
    expect((await autocompleteFree('Brooklyn', fake)).map((s) => s.text)).toEqual(['Brooklyn, Pretoria'])
  })
})
