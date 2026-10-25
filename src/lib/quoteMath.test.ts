import { describe, expect, it } from 'vitest'
import { round2 } from './format'
import { applyLineEdit, applyMarkup, approvalCurrent, describeDuration, lockedPriceLine, markupFromPrice, scheduleStages, priceFromMarkup, quoteTotals, quoteValidationError, type EditableLine } from './quoteMath'

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

describe('management fee and cost split', () => {
  it('adds the fee as its own amount before discount and VAT', () => {
    const t = quoteTotals([line({ quantity: 1, unit_cost: 800, unit_price: 1000 })], 0, 15, 10)
    expect(t).toMatchObject({ subtotal: 1000, managementFee: 100, totalExcl: 1100, vat: 165, totalIncl: 1265, margin: 300 })
  })
  it('splits cost by kind; lines without a kind count as materials', () => {
    const t = quoteTotals(
      [
        { ...line({ quantity: 2, unit_cost: 100, unit_price: 120 }), kind: 'material' as const },
        { ...line({ quantity: 3, unit_cost: 900, unit_price: 1080 }), kind: 'labour' as const },
        line({ quantity: 1, unit_cost: 50, unit_price: 60 }),
      ],
      0,
      15,
    )
    expect(t.costByKind).toEqual({ material: 250, labour: 2700, subcontractor: 0 })
  })
  it('approval holds only at the approved total', () => {
    expect(approvalCurrent({ approved_at: '2026-10-25T08:00:00Z', approved_total: 1100 }, 1100)).toBe(true)
    expect(approvalCurrent({ approved_at: '2026-10-25T08:00:00Z', approved_total: 1100 }, 1100.01)).toBe(false)
    expect(approvalCurrent({ approved_at: null, approved_total: null }, 0)).toBe(false)
  })
})

describe('scheduleStages', () => {
  const st = (name: string, duration_days: number, start_mode: 'start' | 'with' | 'after', start_ref: string | null = null, lag_days = 0) =>
    ({ name, duration_days, start_mode, start_ref, lag_days })

  it("Stephan's example: the basin starts 1 day after the bathroom starts, overlapping by a day", () => {
    const { stages, totalDays } = scheduleStages([st('Bathroom', 2, 'start'), st('Basin', 2, 'with', 'Bathroom', 1)])
    expect(stages.map((s) => [s.startDay, s.endDay])).toEqual([[0, 2], [1, 3]])
    expect(totalDays).toBe(3)
  })
  it('after = when the other finishes; a negative lag overlaps; nothing starts before day 1', () => {
    const { stages, totalDays } = scheduleStages([
      st('Demolition', 3, 'start'),
      st('Plumbing', 2, 'after'), // after the one before
      st('Tiling', 4, 'after', 'Demolition', -1),
      st('Paint', 1, 'with', 'Demolition', -5),
    ])
    expect(stages.map((s) => s.startDay)).toEqual([0, 3, 2, 0])
    expect(totalDays).toBe(6)
  })
  it('a reference to a removed stage falls back to the stage before', () => {
    expect(scheduleStages([st('A', 2, 'start'), st('B', 1, 'after', 'Gone')]).stages[1].startDay).toBe(2)
  })
  it('describes the length in days and weeks', () => {
    expect(describeDuration(0)).toBe('Not planned yet')
    expect(describeDuration(3)).toBe('3 working days')
    expect(describeDuration(9)).toBe('9 working days (about 2 weeks)')
  })
})
