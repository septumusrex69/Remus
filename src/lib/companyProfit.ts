/**
 * WHAT THE COMPANY MADE, MONTH BY MONTH (Remus · Handoff 1, 28 Oct 2026). Stephan: "we got profit per
 * project, and then we have expenses, and then overall profit. Overhead expenses ..."
 *
 * The ladder, all excl. VAT:
 *   invoiced (sent, not drafts or cancelled, by issue date)
 *   − project costs (slips filed on a project, by slip date, plus the crew's booked days in the month)
 *   = profit from jobs
 *   − overheads (slips filed as "Company overhead", i.e. on no project)
 *   = what the company made
 *
 * And the number that tells Stephan whether his markup is high enough: OVERHEADS AS A SHARE OF PROJECT
 * COSTS, over the last few months. If overheads run at R55 000 a month on R400 000 of job costs, every
 * quote needs about 14% on top of cost just to keep the doors open, before any profit.
 *
 * Invoiced, not received: profit is earned when the work is billed; what has been paid is cash, which
 * Finance already shows. The crew's cost is counted by the days booked, like Plan & crew, because
 * that is what Remus knows a worker costs.
 */
import { round2 } from './format'
import { workingDaysBetween } from './workdays'
import type { Expense, Invoice, StageBooking, Worker } from '../types'

export interface MonthProfit {
  /** yyyy-mm */
  month: string
  income: number
  projectCosts: number
  crew: number
  jobProfit: number
  overheads: number
  net: number
}

/** The last `n` months up to and including the one `today` is in, oldest first. */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function monthBounds(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`]
}

export function monthlyProfit(p: {
  months: string[]
  invoices: Invoice[]
  expenses: Expense[]
  bookings: StageBooking[]
  workers: Map<string, Worker>
  today: string
}): MonthProfit[] {
  return p.months.map((month) => {
    const [from, toEnd] = monthBounds(month)
    const to = toEnd > p.today ? p.today : toEnd
    const inMonth = (d: string) => d >= from && d <= toEnd
    const income = p.invoices.filter((i) => !['draft', 'cancelled'].includes(i.status) && inMonth(i.issue_date)).reduce((t, i) => t + Number(i.amount_excl), 0)
    const projectCosts = p.expenses.filter((e) => e.project_id && inMonth(e.date)).reduce((t, e) => t + Number(e.amount_excl), 0)
    const overheads = p.expenses.filter((e) => !e.project_id && inMonth(e.date)).reduce((t, e) => t + Number(e.amount_excl), 0)
    let crew = 0
    if (from <= to) {
      for (const b of p.bookings) {
        const s = b.start_date > from ? b.start_date : from
        const e = b.end_date < to ? b.end_date : to
        if (s <= e) crew += workingDaysBetween(s, e) * Number(p.workers.get(b.worker_id)?.day_cost ?? 0)
      }
    }
    const jobProfit = income - projectCosts - crew
    return {
      month, income: round2(income), projectCosts: round2(projectCosts), crew: round2(crew),
      jobProfit: round2(jobProfit), overheads: round2(overheads), net: round2(jobProfit - overheads),
    }
  })
}

export interface OverheadRecovery {
  /** Average overheads a month, over the months that had any job costs. */
  monthlyOverheads: number
  /** Overheads as a % of job costs: what a quote must add on cost to cover them. */
  pctOnCost: number | null
  months: number
}

/** Over the given months (the current, part month left out by the caller if wanted). */
export function overheadRecovery(rows: MonthProfit[]): OverheadRecovery {
  const counted = rows.filter((r) => r.projectCosts + r.crew > 0 || r.overheads > 0)
  if (!counted.length) return { monthlyOverheads: 0, pctOnCost: null, months: 0 }
  const over = counted.reduce((t, r) => t + r.overheads, 0)
  const cost = counted.reduce((t, r) => t + r.projectCosts + r.crew, 0)
  return {
    monthlyOverheads: round2(over / counted.length),
    pctOnCost: cost > 0 ? Math.round((over / cost) * 1000) / 10 : null,
    months: counted.length,
  }
}
