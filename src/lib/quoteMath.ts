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

/** A line being edited. `fixedPrice` (editor-only, never saved) marks a price entered by hand before any cost. */
export type EditableLine = LineInput & { fixedPrice?: boolean }

/**
 * Applies an edit to a line and keeps cost, markup and price consistent. A line priced by hand
 * with no cost keeps its price: typing a cost then derives the markup from that price (for every
 * keystroke, hence the sticky `fixedPrice`), and a markup change has no cost to apply to. Editing
 * the markup of a costed line hands control back to cost × markup.
 */
export function applyLineEdit<T extends EditableLine>(line: T, p: Partial<T>): T {
  const next = { ...line, ...p }
  const cost = Number(next.unit_cost)
  if ('markup_pct' in p) {
    if (cost) {
      next.unit_price = priceFromMarkup(cost, Number(next.markup_pct))
      next.fixedPrice = false
    } else if (!Number(line.unit_price)) {
      next.unit_price = 0
    }
  } else if ('unit_cost' in p) {
    const fixed = line.fixedPrice || (!Number(line.unit_cost) && Number(line.unit_price) > 0)
    if (fixed) {
      next.fixedPrice = true
      next.markup_pct = markupFromPrice(cost, Number(next.unit_price))
    } else {
      next.unit_price = priceFromMarkup(cost, Number(next.markup_pct))
    }
  } else if ('unit_price' in p) {
    next.markup_pct = markupFromPrice(cost, Number(next.unit_price))
  }
  return next
}

/** "Set markup" for every line; lines with no cost keep their manual price. */
export function applyMarkup<T extends EditableLine>(line: T, markupPct: number): T {
  if (!Number(line.unit_cost)) return line
  return { ...line, markup_pct: markupPct, unit_price: priceFromMarkup(Number(line.unit_cost), markupPct), fixedPrice: false }
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
