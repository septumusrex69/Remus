import { round2 } from './format'
import type { LineKind, QuoteItem, QuoteStage } from '../types'

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
  /** Management fee: its % of the lines' total, rounded to cents, shown to the client as a line. */
  managementFee: number
  estimatedCost: number
  /** Cost split by kind of line. Internal. */
  costByKind: Record<LineKind, number>
  discount: number
  totalExcl: number
  vat: number
  totalIncl: number
  margin: number
  marginPct: number | null
}

/**
 * Same arithmetic as the quote_totals view: sums are rounded once, the fee is rounded to cents,
 * and VAT / total incl. are rounded from the unrounded excl. amount (round(x, 2) is half away
 * from zero, as round2). Lines without a kind count as materials.
 */
export function quoteTotals(
  items: (LineInput & { kind?: LineKind | null })[],
  discount: number,
  vatRate: number,
  managementFeePct = 0,
): QuoteTotals {
  const rawSubtotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0)
  const rawCost = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost), 0)
  const costByKind: Record<LineKind, number> = { material: 0, labour: 0, subcontractor: 0 }
  for (const i of items) costByKind[i.kind ?? 'material'] += Number(i.quantity) * Number(i.unit_cost)
  for (const k of Object.keys(costByKind) as LineKind[]) costByKind[k] = round2(costByKind[k])
  const disc = Number(discount || 0)
  const rate = Number(vatRate || 0)
  const managementFee = round2((rawSubtotal * Number(managementFeePct || 0)) / 100)
  const rawExcl = rawSubtotal + managementFee - disc
  const subtotal = round2(rawSubtotal)
  const estimatedCost = round2(rawCost)
  const totalExcl = round2(rawExcl)
  const vat = round2((rawExcl * rate) / 100)
  const totalIncl = round2(rawExcl * (1 + rate / 100))
  const margin = round2(totalExcl - estimatedCost)
  return {
    subtotal,
    managementFee,
    estimatedCost,
    costByKind,
    discount: disc,
    totalExcl,
    vat,
    totalIncl,
    margin,
    marginPct: totalExcl ? round2((margin / totalExcl) * 100) : null,
  }
}

/** Is the quote's approval still good for what it costs now? */
export function approvalCurrent(quote: { approved_at: string | null; approved_total: number | null }, totalExcl: number): boolean {
  return Boolean(quote.approved_at) && quote.approved_total !== null && round2(Number(quote.approved_total)) === round2(totalExcl)
}

// ---------- Stages: the job on a timeline ----------

export type StagePlan = Pick<QuoteStage, 'name' | 'duration_days' | 'start_mode' | 'start_ref' | 'lag_days'>

/** A stage with no plan saved yet: one day, after the stage before it (or on day 1 if first). */
export function defaultStage(name: string, first: boolean): StagePlan {
  return { name, duration_days: 1, start_mode: first ? 'start' : 'after', start_ref: null, lag_days: 0 }
}

export interface ScheduledStage extends StagePlan {
  /** Working day the stage starts on, counted from 0 (shown as "day 1"). */
  startDay: number
  endDay: number
}

/**
 * Works out when each stage starts, in the order given. A stage can only hang off one before it
 * (the editor offers no other), so there is never a loop; a reference to a stage that no longer
 * exists falls back to the stage before. Nothing starts before day 1.
 */
export function scheduleStages(stages: StagePlan[]): { stages: ScheduledStage[]; totalDays: number } {
  const out: ScheduledStage[] = []
  for (const [i, st] of stages.entries()) {
    const dur = Math.max(0, Math.round(Number(st.duration_days) || 0))
    const lag = Math.round(Number(st.lag_days) || 0)
    const ref = (st.start_ref !== null ? out.find((x) => x.name === st.start_ref) : undefined) ?? out[i - 1]
    let start = 0
    if (st.start_mode === 'start' || !ref) start = Math.max(0, lag)
    else if (st.start_mode === 'with') start = ref.startDay + lag
    else start = ref.endDay + lag
    start = Math.max(0, start)
    out.push({ ...st, duration_days: dur, startDay: start, endDay: start + dur })
  }
  return { stages: out, totalDays: out.reduce((m, s) => Math.max(m, s.endDay), 0) }
}

/** "9 working days (about 2 weeks)". */
export function describeDuration(days: number): string {
  if (days <= 0) return 'Not planned yet'
  const base = `${days} working day${days === 1 ? '' : 's'}`
  if (days < 5) return base
  const weeks = Math.round((days / 5) * 2) / 2
  return `${base} (about ${weeks} week${weeks === 1 ? '' : 's'})`
}

/** First problem that would stop the quote saving (or save nonsense), as a message for the user. */
export function quoteValidationError(
  items: (LineInput & { description?: string })[],
  discount: number,
  vatRate: number,
  managementFeePct = 0,
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
  const raw = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0)
  const fee = round2((raw * Number(managementFeePct || 0)) / 100)
  if (!Number.isFinite(d) || d < 0) return 'The discount cannot be negative.'
  if (d > round2(raw + fee)) return 'The discount cannot be more than the subtotal.'
  const f = Number(managementFeePct || 0)
  if (!Number.isFinite(f) || f < 0 || f > 100) return 'The management fee must be between 0 and 100%.'
  const v = Number(vatRate)
  if (!Number.isFinite(v) || v < 0 || v > 100) return 'The VAT rate must be between 0 and 100%.'
  return null
}

/** Splits a VAT-inclusive amount, e.g. a till slip total. */
export function splitInclusive(totalIncl: number, vatRate: number): { excl: number; vat: number } {
  const excl = round2(totalIncl / (1 + vatRate / 100))
  return { excl, vat: round2(totalIncl - excl) }
}
