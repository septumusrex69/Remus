import { round2 } from './format'
import type { QuoteItem } from '../types'

export type LineInput = Pick<QuoteItem, 'quantity' | 'unit_cost' | 'markup_pct' | 'unit_price'>

/** Selling price from cost and markup. */
export function priceFromMarkup(unitCost: number, markupPct: number): number {
  return round2(unitCost * (1 + markupPct / 100))
}

/** Markup implied by a manually entered selling price. */
export function markupFromPrice(unitCost: number, unitPrice: number): number {
  if (!unitCost) return 0
  return round2((unitPrice / unitCost - 1) * 100)
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

export function quoteTotals(items: LineInput[], discount: number, vatRate: number): QuoteTotals {
  const subtotal = round2(items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0))
  const estimatedCost = round2(items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost), 0))
  const totalExcl = round2(subtotal - Number(discount || 0))
  const vat = round2((totalExcl * Number(vatRate || 0)) / 100)
  const margin = round2(totalExcl - estimatedCost)
  return {
    subtotal,
    estimatedCost,
    discount: Number(discount || 0),
    totalExcl,
    vat,
    totalIncl: round2(totalExcl + vat),
    margin,
    marginPct: totalExcl ? round2((margin / totalExcl) * 100) : null,
  }
}

/** Splits a VAT-inclusive amount, e.g. a till slip total. */
export function splitInclusive(totalIncl: number, vatRate: number): { excl: number; vat: number } {
  const excl = round2(totalIncl / (1 + vatRate / 100))
  return { excl, vat: round2(totalIncl - excl) }
}
