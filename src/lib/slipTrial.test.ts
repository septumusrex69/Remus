import { describe, expect, it } from 'vitest'
import { sameValue, summariseTrials } from './slipTrial'

describe('sameValue', () => {
  it('matches suppliers on their words, not their dressing', () => {
    expect(sameValue('supplier', 'CASHBUILD (Pty) Ltd.', 'Cashbuild')).toBe(true)
    expect(sameValue('supplier', 'Builders Warehouse Menlyn', 'Builders Warehouse')).toBe(true)
    expect(sameValue('supplier', 'Cashbuild', 'BUCO')).toBe(false)
  })
  it('matches amounts to the cent', () => {
    expect(sameValue('total_incl', 1819.81, '1819.81')).toBe(true)
    expect(sameValue('total_incl', 1819.81, 1819.18)).toBe(false)
  })
  it('matches slip numbers without leading zeros or dashes', () => {
    expect(sameValue('slip_number', 'INV-000123', 'inv123')).toBe(true)
    expect(sameValue('slip_number', 'INV-123', 'INV-124')).toBe(false)
  })
  it('counts nothing read as right only when there is nothing to read', () => {
    expect(sameValue('vat', null, null)).toBe(true)
    expect(sameValue('vat', null, 237.37)).toBe(false)
  })
})

describe('summariseTrials', () => {
  it('scores each reader against the truth, and their agreement on every slip', () => {
    const s = summariseTrials([
      {
        old_result: { extraction: { supplier: 'Cashbuild', total_incl: 100, date: '2026-10-30' } },
        new_result: { extraction: { supplier: 'CASHBUILD', total_incl: 100, date: '2026-10-31' } },
        truth: { supplier: 'Cashbuild', total_incl: 100, date: '2026-10-30' },
        old_usd: 0.03, new_usd: 0.0004,
      },
      {
        old_result: { extraction: { supplier: 'BUCO', total_incl: 50 } },
        new_result: { error: 'max_tokens' },
        truth: null,
        old_usd: 0.03, new_usd: 0.0006,
      },
    ])
    expect(s.slips).toBe(2)
    expect(s.checked).toBe(1)
    const date = s.fields.find((f) => f.field === 'date')!
    expect([date.checked, date.oldRight, date.newRight]).toEqual([1, 1, 0])
    const supplier = s.fields.find((f) => f.field === 'supplier')!
    expect([supplier.agree, supplier.compared]).toEqual([1, 2])
    expect(s.oldUsdPerSlip).toBeCloseTo(0.03)
    expect(s.newUsdPerSlip).toBeCloseTo(0.0005)
  })
})
