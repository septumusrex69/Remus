import { describe, expect, it } from 'vitest'
import { choicesFromSlip, creditFor, itemsFromChoices, itemsLabel, itemsTotal, openSummary } from './slipReturns'

// Stephan's example: ten paint strippers bought, five used, five go back.
const slipLines = [
  { description: 'Paint stripper 5L', quantity: 10, amount: 1899 },
  { description: 'Scraper', quantity: null, amount: 45.5 },
  { description: '  ', quantity: 1, amount: 1 },
  { description: 'Gloves', quantity: 2, amount: null },
]

describe('returns', () => {
  it('turns the slip lines into choices with the price of one', () => {
    const c = choicesFromSlip(slipLines)
    expect(c).toHaveLength(3)
    expect(c[0]).toEqual({ description: 'Paint stripper 5L', bought: 10, unit_price: 189.9, qty: 0 })
    expect(c[1]).toEqual({ description: 'Scraper', bought: 1, unit_price: 45.5, qty: 0 })
    expect(c[2].unit_price).toBeNull()
    expect(choicesFromSlip(null)).toEqual([])
  })

  it('prices the lines going back and leaves the rest', () => {
    const c = choicesFromSlip(slipLines)
    c[0].qty = 5
    const items = itemsFromChoices(c)
    expect(items).toEqual([{ description: 'Paint stripper 5L', quantity: 5, unit_price: 189.9, amount: 949.5 }])
    expect(itemsTotal(items)).toBe(949.5)
    expect(itemsLabel(items)).toBe('5 × Paint stripper 5L')
  })

  it('writes the credit as negative amounts on the slip’s job, VAT in the slip’s share', () => {
    const ret = { project_id: 'p1', stage_id: 's1', category: 'materials' as const, supplier: 'Builders', receipt_number: '12345',
      items: [{ description: 'Paint stripper 5L', quantity: 5, unit_price: 189.9, amount: 949.5 }] }
    const slip = { amount_excl: 1651.3, vat: 247.7 } // R 1 899.00 incl., 15%
    const c = creditFor(ret, { date: '2026-11-03', amount_incl: 949.5, credit_number: 'CN-9' }, slip, 15)
    expect(c.vat).toBe(-123.85)
    expect(c.amount_excl).toBe(-825.65)
    expect(c.amount_excl + c.vat).toBeCloseTo(-949.5, 2)
    expect(c.project_id).toBe('p1')
    expect(c.stage_id).toBe('s1')
    expect(c.receipt_number).toBe('CN-9')
    expect(c.description).toBe('Return: 5 × Paint stripper 5L · slip 12345')
  })

  it('takes no VAT off when the slip had none (not registered), and the rate without a slip', () => {
    const ret = { project_id: null, stage_id: 's1', category: 'materials' as const, supplier: null, receipt_number: null, items: [] }
    const noVat = creditFor(ret, { date: '2026-11-03', amount_incl: 100 }, { amount_excl: 500, vat: 0 }, 15)
    expect(noVat).toMatchObject({ amount_excl: -100, vat: -0, stage_id: null, description: 'Return' })
    const noSlip = creditFor(ret, { date: '2026-11-03', amount_incl: 115 }, null, 15)
    expect(noSlip.vat).toBe(-15)
    expect(noSlip.amount_excl).toBe(-100)
  })

  it('counts what is still waiting to go back', () => {
    expect(openSummary([
      { status: 'to_return', amount_incl: 949.5 },
      { status: 'returned', amount_incl: 100 },
      { status: 'to_return', amount_incl: 50.5 },
      { status: 'cancelled', amount_incl: 10 },
    ])).toEqual({ count: 2, amount: 1000 })
  })
})
