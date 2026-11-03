import { describe, expect, it } from 'vitest'
import { OVERHEAD_KINDS, guessOverheadKind, overheadLabel } from './overheads'

describe('overheads by kind', () => {
  it('has unique kinds, internet and car maintenance among them, and Other last', () => {
    expect(new Set(OVERHEAD_KINDS.map((k) => k.id)).size).toBe(OVERHEAD_KINDS.length)
    expect(overheadLabel('internet_phone')).toBe('Internet & phones')
    expect(overheadLabel('vehicle_maintenance')).toBe('Vehicles: maintenance & repairs')
    expect(OVERHEAD_KINDS[OVERHEAD_KINDS.length - 1].id).toBe('other')
    expect(overheadLabel(null)).toBe('Overheads')
  })
  it('guesses the kind from the supplier, and leaves it when it cannot tell', () => {
    expect(guessOverheadKind('Engen Rivonia')).toBe('vehicle_fuel')
    expect(guessOverheadKind('Vodacom', 'monthly contract')).toBe('internet_phone')
    expect(guessOverheadKind('Tiger Wheel & Tyre')).toBe('vehicle_maintenance')
    expect(guessOverheadKind('Cashbuild')).toBeNull()
    expect(guessOverheadKind(null, '')).toBeNull()
  })
})
