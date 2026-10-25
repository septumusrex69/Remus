import { round2 } from './format'
import type { QuoteItem } from '../types'

export type LineInput = Pick<QuoteItem, 'quantity' | 'unit_cost' | 'markup_pct' | 'unit_price'>

/** Column limits from the schema: markup_pct numeric(7,2), quantity numeric(14,3), money numeric(14,2). */
export const MAX_MARKUP_PCT = 99999.99
export const MAX_QUANTITY = 99_999_999_999.999
export const MAX_AMOUNT = 999_999_999_999.99

/** Selling price from cost and markup. */
export function priceFromMarkup(unitCost: number, markupPct: number): number {
  return round2(unitCost * (1 + markupPct / 100))
}

/** Markup implied by a manually entered selling price. */
export function markupFromPrice(unitCost: number, unitPrice: number): number {
  if (!unitCost) return 0
  return round2((unitPrice / unitCost - 1) * 100)
}

/** A line being edited. */
export type EditableLine = LineInput

/**
 * The unit price is never typed: it is always unit cost × (1 + markup). Stephan, 25 Oct 2026:
 * "unit cost is changeable, markup is changeable, unit price stays unchangeable". 0% markup sells
 * at cost.
 */
export function applyLineEdit<T extends EditableLine>(line: T, p: Partial<T>): T {
  const next = { ...line, ...p }
  next.unit_price = priceFromMarkup(Number(next.unit_cost), Number(next.markup_pct))
  return next
}

/**
 * A line saved before the price was locked, priced by hand with no cost (cost 0, price 6 000):
 * shown as cost 6 000 at 0% markup, so the client's price stays exactly what it was. Every other
 * line is left as saved until somebody edits it.
 */
export function lockedPriceLine<T extends EditableLine>(line: T): T {
  if (Number(line.unit_cost) || !Number(line.unit_price)) return line
  return { ...line, unit_cost: Number(line.unit_price), markup_pct: 0 }
}

/** "Set markup" for every line. */
export function applyMarkup<T extends EditableLine>(line: T, markupPct: number): T {
  return applyLineEdit(line, { markup_pct: markupPct } as Partial<T>)
}

export interface QuoteTotals {
  subtotal: number
  estimatedCost: number
  discount: number
  totalExcl: number
  vat: number
  totalIncl: number
  margin: number
  marginPct: number | null
}

/**
 * Same arithmetic as the quote_totals view: sums are rounded once, and VAT / total incl. are
 * rounded from the unrounded excl. amount (round(x, 2) is half away from zero, as round2).
 */
export function quoteTotals(items: LineInput[], discount: number, vatRate: number): QuoteTotals {
  const rawSubtotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0)
  const rawCost = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost), 0)
  const disc = Number(discount || 0)
  const rate = Number(vatRate || 0)
  const subtotal = round2(rawSubtotal)
  const estimatedCost = round2(rawCost)
  const totalExcl = round2(rawSubtotal - disc)
  const vat = round2(((rawSubtotal - disc) * rate) / 100)
  const totalIncl = round2((rawSubtotal - disc) * (1 + rate / 100))
  const margin = round2(totalExcl - estimatedCost)
  return {
    subtotal,
    estimatedCost,
    discount: disc,
    totalExcl,
    vat,
    totalIncl,
    margin,
    marginPct: totalExcl ? round2((margin / totalExcl) * 100) : null,
  }
}

/** First problem that would stop the quote saving (or save nonsense), as a message for the user. */
export function quoteValidationError(
  items: (LineInput & { description?: string })[],
  discount: number,
  vatRate: number,
): string | null {
  for (const [idx, i] of items.entries()) {
    const label = i.description?.trim() ? `"${i.description.trim()}"` : `line ${idx + 1}`
    const q = Number(i.quantity)
    const m = Number(i.markup_pct)
    if (!Number.isFinite(q) || Math.abs(q) > MAX_QUANTITY) return `The quantity on ${label} is not a valid number.`
    if (!Number.isFinite(Number(i.unit_cost)) || Math.abs(Number(i.unit_cost)) > MAX_AMOUNT) return `The unit cost on ${label} is too large.`
    if (!Number.isFinite(Number(i.unit_price)) || Math.abs(Number(i.unit_price)) > MAX_AMOUNT) return `The unit price on ${label} is too large.`
    if (!Number.isFinite(m) || Math.abs(m) > MAX_MARKUP_PCT)
      return `The markup on ${label} is out of range (at most ${MAX_MARKUP_PCT}%). Check the unit cost and price.`
  }
  const d = Number(discount || 0)
  const subtotal = round2(items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0))
  if (!Number.isFinite(d) || d < 0) return 'The discount cannot be negative.'
  if (d > subtotal) return 'The discount cannot be more than the subtotal.'
  const v = Number(vatRate)
  if (!Number.isFinite(v) || v < 0 || v > 100) return 'The VAT rate must be between 0 and 100%.'
  return null
}

/** Splits a VAT-inclusive amount, e.g. a till slip total. */
export function splitInclusive(totalIncl: number, vatRate: number): { excl: number; vat: number } {
  const excl = round2(totalIncl / (1 + vatRate / 100))
  return { excl, vat: round2(totalIncl - excl) }
}
