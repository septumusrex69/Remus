/**
 * QUOTED VS ACTUAL, FOR A WHOLE PROJECT (Remus · Handoff 1, 28 Oct 2026). Stephan: "something to show
 * like what was estimated for the project. Did we overquote? ... the profit."
 *
 * One calculation, used by the project's scorecard and by the company dashboard, so the two never
 * disagree about a job. Every figure is excl. VAT.
 *
 *  - QUOTED comes from the accepted quote's lines (quoteTotals: cost by kind, and the price). A project
 *    made without a quote has only its budget, so it has a quoted total and no breakdown.
 *  - ACTUAL is the project's slips by category, plus the crew's days up to today from the register,
 *    or the bookings where nobody has registered the day (lib/crewDays.ts) -- the sum Plan & crew uses.
 *  - The money in is the contract plus approved variations. Variations add income the quote never
 *    priced the cost of, so they are shown, not hidden in "we did better than quoted".
 */
import { round2 } from './format'
import { workingDaysBetween } from './workdays'
import { quoteTotals } from './quoteMath'
import type { Expense, ProjectStatus, Quote, QuoteItem } from '../types'

export interface CostSplit { material: number; labour: number; subcontractor: number; other: number; total: number }

export const NO_COST: CostSplit = { material: 0, labour: 0, subcontractor: 0, other: 0, total: 0 }

/** The quote's cost by kind, or, with no quote, the project's budget as a total with no breakdown. */
export function quotedCost(quote: Quote | null, items: QuoteItem[], budget: number): CostSplit | null {
  if (quote && items.length) {
    const t = quoteTotals(items, quote.discount, quote.vat_rate, quote.management_fee_pct)
    return { material: t.costByKind.material, labour: t.costByKind.labour, subcontractor: t.costByKind.subcontractor, other: 0, total: t.estimatedCost }
  }
  return budget > 0 ? { material: 0, labour: 0, subcontractor: 0, other: 0, total: round2(budget) } : null
}

/** A project's slips by category, with the crew's cost added to labour. */
export function actualCost(expenses: Expense[], crew = 0): CostSplit {
  const sum = (pred: (e: Expense) => boolean) => expenses.filter(pred).reduce((t, e) => t + Number(e.amount_excl), 0)
  const material = round2(sum((e) => e.category === 'materials'))
  const labour = round2(sum((e) => e.category === 'labour') + crew)
  const subcontractor = round2(sum((e) => e.category === 'subcontractor'))
  const other = round2(sum((e) => !['materials', 'labour', 'subcontractor'].includes(e.category)))
  return { material, labour, subcontractor, other, total: round2(material + labour + subcontractor + other) }
}

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

export interface JobScore {
  tone: Tone
  headline: string
  detail: string | null
  quotedProfit: number
  profitNow: number
  /** What the job is on course to make if the rest of the quoted cost is spent as quoted (running jobs). */
  profitForecast: number | null
  costPct: number | null
  timePct: number | null
}

/*
 * THE VERDICT. A finished job is judged on its cost against the quoted cost: 5% either side is "on
 * budget" (slips are never exact), more over is over, and more than 10% UNDER says the quote may have
 * been high -- Stephan's own question, "did we overquote?" -- because a price well above the cost wins
 * fewer jobs. A running job is judged on pace: the share of the quoted cost spent against the share of
 * the working days gone. Spending 15 points ahead of the calendar is the warning; anything less is
 * normal (materials are bought up front).
 */
export function scoreJob(p: {
  quoted: CostSplit | null
  actual: CostSplit
  contract: number
  variations: number
  status: ProjectStatus
  start: string | null
  end: string | null
  today: string
}): JobScore {
  const income = round2(p.contract + p.variations)
  const profitNow = round2(income - p.actual.total)
  const quotedCost = p.quoted?.total ?? 0
  const quotedProfit = round2(p.contract - quotedCost)
  const costPct = quotedCost > 0 ? Math.round((p.actual.total / quotedCost) * 100) : null
  let timePct: number | null = null
  if (p.start && p.end && p.end >= p.start) {
    const all = workingDaysBetween(p.start, p.end)
    const gone = p.today < p.start ? 0 : workingDaysBetween(p.start, p.today < p.end ? p.today : p.end)
    timePct = all > 0 ? Math.round((gone / all) * 100) : null
  }
  const diff = round2(p.actual.total - quotedCost)
  const R = (n: number) => `R ${Math.abs(Math.round(n)).toLocaleString('en-ZA').replace(/ /g, ' ')}`

  if (!quotedCost) {
    return { tone: 'neutral', headline: 'No quoted cost to compare with', detail: 'Link the accepted quote to this project (or set a budget) to see quoted against actual.', quotedProfit, profitNow, profitForecast: null, costPct, timePct }
  }
  if (p.status === 'completed') {
    const pct = (diff / quotedCost) * 100
    if (pct > 5) return { tone: 'bad', headline: `Came in over budget by ${R(diff)} (${Math.round(pct)}%)`, detail: overWhere(p.quoted!, p.actual), quotedProfit, profitNow, profitForecast: null, costPct, timePct }
    if (pct < -10) return { tone: 'warn', headline: `Came in ${R(diff)} under the quoted cost (${Math.round(-pct)}%)`, detail: 'You may have quoted high. A sharper price on the next job like this could win more work.', quotedProfit, profitNow, profitForecast: null, costPct, timePct }
    return { tone: 'good', headline: 'Finished on budget', detail: `Within ${R(diff)} of the quoted cost.`, quotedProfit, profitNow, profitForecast: null, costPct, timePct }
  }

  // Not finished: where it is heading, if what is left costs what was quoted for it.
  const forecastCost = Math.max(p.actual.total, quotedCost)
  const profitForecast = round2(income - forecastCost)
  if (diff > 0) {
    return { tone: 'bad', headline: `Already ${R(diff)} over the quoted cost`, detail: overWhere(p.quoted!, p.actual), quotedProfit, profitNow, profitForecast, costPct, timePct }
  }
  if (costPct != null && timePct != null && costPct - timePct >= 15) {
    return { tone: 'warn', headline: `Spending ahead of the work: ${costPct}% of the cost used, ${timePct}% of the time gone`, detail: 'Worth a look before it runs over.', quotedProfit, profitNow, profitForecast, costPct, timePct }
  }
  return { tone: 'good', headline: 'On track', detail: costPct != null ? `${costPct}% of the quoted cost used${timePct != null ? `, ${timePct}% of the time gone` : ''}.` : null, quotedProfit, profitNow, profitForecast, costPct, timePct }
}

/** Which kind of cost ran over the most, in words. */
function overWhere(q: CostSplit, a: CostSplit): string | null {
  const rows = ([['Materials', q.material, a.material], ['Labour', q.labour, a.labour], ['Subcontractors', q.subcontractor, a.subcontractor], ['Other costs', q.other, a.other]] as const)
    .map(([name, quoted, actual]) => ({ name, over: actual - quoted }))
    .filter((r) => r.over > 0)
    .sort((x, y) => y.over - x.over)
  if (!rows.length) return null
  return `Mostly ${rows[0].name.toLowerCase()}: R ${Math.round(rows[0].over).toLocaleString('en-ZA').replace(/ /g, ' ')} more than quoted.`
}
