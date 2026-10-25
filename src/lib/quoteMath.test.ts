import { describe, expect, it } from 'vitest'
import { round2 } from './format'
import { applyLineEdit, applyMarkup, lockedPriceLine, markupFromPrice, priceFromMarkup, quoteTotals, quoteValidationError, type EditableLine } from './quoteMath'

const line = (p: Partial<EditableLine> = {}): EditableLine => ({ quantity: 1, unit_cost: 0, markup_pct: 20, unit_price: 0, ...p })

describe('round2', () => {
  it('rounds half away from zero like Postgres round(x, 2)', () => {
    expect(round2(2.175)).toBe(2.18) // 14.50 × 15%
    expect(round2(0.615)).toBe(0.62) // 4.10 × 15%
    expect(round2(1.005)).toBe(1.01)
    expect(round2(1.004)).toBe(1)
    expect(round2(-2.175)).toBe(-2.18)
    expect(round2(-0.615)).toBe(-0.62)
    expect(round2(-0.001)).toBe(0)
    expect(Object.is(round2(-0.001), -0)).toBe(false)
    expect(round2(123456789.125)).toBe(123456789.13)
    expect(round2(0.1 + 0.2)).toBe(0.3)
  })
})

describe('quoteTotals', () => {
  it('VAT matches the quote_totals view to the cent', () => {
    expect(quoteTotals([line({ unit_price: 14.5 })], 0, 15).vat).toBe(2.18)
    expect(quoteTotals([line({ unit_price: 4.1 })], 0, 15).vat).toBe(0.62)
    const t = quoteTotals([line({ unit_price: 4.1 })], 0, 15)
    expect(t.totalIncl).toBe(4.72)
  })

  it('rounds VAT from the unrounded excl. amount, as the view does', () => {
    // 3.335 × 3.00 = 10.005 → excl 10.01; VAT round(1.50075) = 1.50; incl round(11.50575) = 11.51
    const t = quoteTotals([{ quantity: 3.335, unit_cost: 0, markup_pct: 0, unit_price: 3 }], 0, 15)
    expect(t.subtotal).toBe(10.01)
    expect(t.totalExcl).toBe(10.01)
    expect(t.vat).toBe(1.5)
    expect(t.totalIncl).toBe(11.51)
  })

  it('applies the discount before VAT', () => {
    const t = quoteTotals([line({ quantity: 2, unit_cost: 40, unit_price: 50 })], 10, 15)
    expect(t).toMatchObject({ subtotal: 100, totalExcl: 90, vat: 13.5, totalIncl: 103.5, estimatedCost: 80, margin: 10 })
  })
})

describe('line pricing', () => {
  it('derives price from cost and markup and back', () => {
    expect(priceFromMarkup(100, 20)).toBe(120)
    expect(markupFromPrice(100, 125)).toBe(25)
    expect(markupFromPrice(0, 125)).toBe(0)
  })

  it('the price is always cost × markup', () => {
    let l = applyLineEdit(line(), { unit_cost: 100 })
    expect(l.unit_price).toBe(120)
    l = applyLineEdit(l, { markup_pct: 50 })
    expect(l.unit_price).toBe(150)
    l = applyLineEdit(l, { markup_pct: 0 })
    expect(l.unit_price).toBe(100)
    expect(applyMarkup(line({ unit_cost: 100, unit_price: 120 }), 30).unit_price).toBe(130)
  })

  it('a line priced by hand with no cost keeps its price', () => {
    const l = lockedPriceLine(line({ unit_cost: 0, markup_pct: 20, unit_price: 6000 }))
    expect(l).toMatchObject({ unit_cost: 6000, markup_pct: 0, unit_price: 6000 })
    expect(lockedPriceLine(line({ unit_cost: 100, unit_price: 125 })).unit_cost).toBe(100)
  })
})

describe('quoteValidationError', () => {
  it('flags out-of-range values', () => {
    expect(quoteValidationError([line({ unit_price: 10 })], 0, 15)).toBeNull()
    expect(quoteValidationError([line({ markup_pct: 100000 })], 0, 15)).toMatch(/markup/)
    expect(quoteValidationError([line({ quantity: 1e12 })], 0, 15)).toMatch(/quantity/)
    expect(quoteValidationError([line({ unit_price: 10 })], -1, 15)).toMatch(/negative/)
    expect(quoteValidationError([line({ unit_price: 10 })], 11, 15)).toMatch(/subtotal/)
    expect(quoteValidationError([line({ unit_price: 10 })], 0, 101)).toMatch(/VAT/)
  })
})
