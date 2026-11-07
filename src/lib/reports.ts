/**
 * THE REPORTS, WORKED OUT (Remus · Handover 8). Stephan, 7 Nov, of the list of reports a builder needs: "we can
 * start with pretty much all of that."
 *
 * Raptor's Reports page (src/pages/reports/ReportsPage.tsx) is a sales firm's: leads, pipeline, deals won. Remus's
 * keeps its shape -- one page, a period picker, a tab per report -- and asks a builder's questions instead:
 *
 *   Profit per job      what each job invoiced in the period, less its slips and its crew      (companyProfit.ts's ladder)
 *   Spending            by category, and overheads by kind                                    (overheads.ts)
 *   Outstanding         who owes what, and how late                                           (finance.ts's ageing)
 *   Quotes              won, lost, still out                                                  (quote status)
 *   Crew                days and wages per job per month, and per person                      (crewDays.ts)
 *   Slips by supplier   what we spent where                                                   (expenses)
 *   Returns             what went back to the store and what it credited                      (slip_returns, 0036)
 *
 * PURE, so every figure is checked without a browser (reports.test.ts), and every figure goes through the same
 * helpers the rest of Remus uses, so a report never disagrees with the page it summarises.
 */
import { round2 } from './format'
import { AGEING_BUCKETS, outstandingInvoices, type AgeingBucket } from './finance'
import { workedDays, type CrewSources } from './crewDays'
import { overheadLabel } from './overheads'
import type { SlipReturn } from './slipReturns'
import type { Expense, ExpenseCategory, Invoice, Payment, Project, Quote, QuoteStatus, QuoteTotalsRow, Worker } from '../types'

const inRange = (d: string | null | undefined, from: string, to: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to
const sum = <T>(xs: T[], f: (x: T) => number) => round2(xs.reduce((s, x) => s + f(x), 0))
const billed = (i: Invoice) => i.status !== 'draft' && i.status !== 'cancelled'

/* ------------------------------------------------------------------ *
 * Profit per job
 * ------------------------------------------------------------------ */

export interface JobProfitRow {
  project: Project
  contract: number
  /** Invoiced in the period, excl. VAT, by issue date (not drafts, not cancelled). */
  invoiced: number
  /** Slips on the job in the period, excl. VAT (a return's credit counts off). */
  slips: number
  /** The crew's days on the job in the period (crewDays.ts: the register, else the bookings). */
  crew: number
  profit: number
  /** Profit as a % of invoiced; null when nothing was invoiced. */
  margin: number | null
}

/**
 * companyProfit.ts's ladder, one job at a time: invoiced − slips − crew. Invoiced, not received: profit is earned
 * when the work is billed (Finance already shows the cash). Jobs with nothing in the period are left out.
 */
export function profitPerJob(p: {
  projects: Project[]; invoices: Invoice[]; expenses: Expense[]; crew: CrewSources; from: string; to: string; today: string
}): JobProfitRow[] {
  const crewTo = p.to < p.today ? p.to : p.today
  const days = crewTo >= p.from ? workedDays(p.crew, p.from, crewTo) : []
  return p.projects
    .map((project) => {
      const invoiced = sum(p.invoices.filter((i) => i.project_id === project.id && billed(i) && inRange(i.issue_date, p.from, p.to)), (i) => Number(i.amount_excl))
      const slips = sum(p.expenses.filter((e) => e.project_id === project.id && inRange(e.date, p.from, p.to)), (e) => Number(e.amount_excl))
      const crew = sum(days.filter((d) => d.project_id === project.id), (d) => d.cost)
      const profit = round2(invoiced - slips - crew)
      return { project, contract: Number(project.contract_value), invoiced, slips, crew, profit, margin: invoiced ? Math.round((profit / invoiced) * 1000) / 10 : null }
    })
    .filter((r) => r.invoiced || r.slips || r.crew)
    .sort((a, b) => b.profit - a.profit)
}

/* ------------------------------------------------------------------ *
 * Spending
 * ------------------------------------------------------------------ */

export interface SpendRow { name: string; count: number; excl: number; vat: number; incl: number }

function group<K extends string>(expenses: Expense[], key: (e: Expense) => K, label: (k: K) => string): SpendRow[] {
  const by = new Map<K, Expense[]>()
  for (const e of expenses) by.set(key(e), [...(by.get(key(e)) ?? []), e])
  return [...by].map(([k, xs]) => {
    const excl = sum(xs, (e) => Number(e.amount_excl))
    const vat = sum(xs, (e) => Number(e.vat))
    return { name: label(k), count: xs.length, excl, vat, incl: round2(excl + vat) }
  }).filter((r) => r.count > 0).sort((a, b) => b.excl - a.excl)
}

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  materials: 'Materials', labour: 'Labour', subcontractor: 'Subcontractors', plant_hire: 'Plant hire',
  transport: 'Transport', permits: 'Permits', overheads: 'Overheads', other: 'Other',
}

export function spendByCategory(expenses: Expense[]): SpendRow[] {
  return group(expenses, (e) => e.category, (c) => CATEGORY_LABEL[c] ?? c)
}

/** Slips on no job, by what they were for (Stephan, 3 Nov: "if it's internet, or if it's car maintenance"). */
export function overheadsByKind(expenses: Expense[]): SpendRow[] {
  return group(expenses.filter((e) => !e.project_id), (e) => overheadLabel(e.overhead_kind), (k) => k)
}

/** Job costs against overheads, the split that tells Stephan whether his markup carries the company. */
export function jobVersusOverhead(expenses: Expense[]): { jobs: number; overheads: number } {
  return { jobs: sum(expenses.filter((e) => e.project_id), (e) => Number(e.amount_excl)), overheads: sum(expenses.filter((e) => !e.project_id), (e) => Number(e.amount_excl)) }
}

/* ------------------------------------------------------------------ *
 * Outstanding by client, with ageing
 * ------------------------------------------------------------------ */

export interface ClientOwingRow {
  kind: 'company' | 'contact' | 'none'
  id: string | null
  name: string
  invoices: number
  buckets: Record<AgeingBucket, number>
  total: number
  /** Days the oldest unpaid invoice is overdue. */
  oldest: number
}

/** finance.ts's outstanding invoices, added up per client; worst first. */
export function outstandingByClient(invoices: Invoice[], payments: Payment[], nameOf: (ref: Pick<Invoice, 'company_id' | 'contact_id'>) => string, today = new Date()): ClientOwingRow[] {
  const by = new Map<string, ClientOwingRow>()
  for (const o of outstandingInvoices(invoices, payments, today)) {
    const { company_id, contact_id } = o.invoice
    const kind = company_id ? 'company' : contact_id ? 'contact' : 'none'
    const id = company_id ?? contact_id ?? null
    const key = `${kind}:${id}`
    const row = by.get(key) ?? {
      kind, id, name: nameOf(o.invoice), invoices: 0, total: 0, oldest: 0,
      buckets: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<AgeingBucket, number>,
    }
    row.invoices += 1
    row.buckets[o.bucket] = round2(row.buckets[o.bucket] + o.outstanding)
    row.total = round2(row.total + o.outstanding)
    row.oldest = Math.max(row.oldest, o.daysOverdue)
    by.set(key, row)
  }
  return [...by.values()].sort((a, b) => b.oldest - a.oldest || b.total - a.total)
}

/* ------------------------------------------------------------------ *
 * Quotes won and lost
 * ------------------------------------------------------------------ */

export interface QuoteStatusRow { status: QuoteStatus; label: string; count: number; value: number }

export const QUOTE_STATUS_WORDS: Record<QuoteStatus, string> = {
  draft: 'Still being written', sent: 'Out with the client', accepted: 'Won', declined: 'Lost', expired: 'Expired',
}

/**
 * Quotes dated in the period, by where they stand, valued excl. VAT. The WIN RATE counts only the ones decided:
 * won ÷ (won + lost + expired) -- a quote still out has not been lost yet.
 */
export function quotesReport(quotes: Quote[], totals: Map<string, QuoteTotalsRow>, from: string, to: string): {
  rows: QuoteStatusRow[]; quotes: Quote[]; winRate: number | null; wonValue: number; lostValue: number
} {
  const mine = quotes.filter((q) => inRange(q.issue_date, from, to))
  const value = (q: Quote) => Number(totals.get(q.id)?.total_excl ?? 0)
  const rows = (Object.keys(QUOTE_STATUS_WORDS) as QuoteStatus[]).map((status) => {
    const xs = mine.filter((q) => q.status === status)
    return { status, label: QUOTE_STATUS_WORDS[status], count: xs.length, value: sum(xs, value) }
  })
  const n = (s: QuoteStatus) => rows.find((r) => r.status === s)!.count
  const decided = n('accepted') + n('declined') + n('expired')
  return {
    rows,
    quotes: [...mine].sort((a, b) => (a.issue_date < b.issue_date ? 1 : -1)),
    winRate: decided ? Math.round((n('accepted') / decided) * 100) : null,
    wonValue: rows.find((r) => r.status === 'accepted')!.value,
    lostValue: round2(rows.find((r) => r.status === 'declined')!.value + rows.find((r) => r.status === 'expired')!.value),
  }
}

/* ------------------------------------------------------------------ *
 * Crew days and wages
 * ------------------------------------------------------------------ */

export interface CrewJobMonthRow { projectId: string; month: string; days: number; wages: number; unconfirmedDays: number }
export interface CrewWorkerRow { workerId: string; name: string; days: number; wages: number; unconfirmedDays: number; jobs: number }

/** Through crewDays.ts, so the wages here are the wage list's and the job's labour cost, to the cent. */
export function crewReport(crew: CrewSources, from: string, to: string, today: string): { byJobMonth: CrewJobMonthRow[]; byWorker: CrewWorkerRow[] } {
  const end = to < today ? to : today
  const days = end >= from ? workedDays(crew, from, end) : []
  const jm = new Map<string, CrewJobMonthRow>()
  const wk = new Map<string, CrewWorkerRow & { projects: Set<string> }>()
  for (const d of days) {
    const month = d.day.slice(0, 7)
    const k = `${d.project_id}|${month}`
    const r = jm.get(k) ?? { projectId: d.project_id, month, days: 0, wages: 0, unconfirmedDays: 0 }
    r.days += d.days
    r.wages = round2(r.wages + d.cost)
    if (!d.confirmed) r.unconfirmedDays += d.days
    jm.set(k, r)
    const w = wk.get(d.worker_id) ?? { workerId: d.worker_id, name: (crew.workers.get(d.worker_id) as Worker | undefined)?.name ?? 'Someone', days: 0, wages: 0, unconfirmedDays: 0, jobs: 0, projects: new Set<string>() }
    w.days += d.days
    w.wages = round2(w.wages + d.cost)
    if (!d.confirmed) w.unconfirmedDays += d.days
    if (d.days > 0) w.projects.add(d.project_id)
    wk.set(d.worker_id, w)
  }
  return {
    byJobMonth: [...jm.values()].filter((r) => r.days > 0 || r.wages > 0).sort((a, b) => (a.month === b.month ? b.wages - a.wages : a.month < b.month ? -1 : 1)),
    byWorker: [...wk.values()].filter((w) => w.days > 0 || w.wages > 0).map(({ projects, ...w }) => ({ ...w, jobs: projects.size })).sort((a, b) => b.wages - a.wages),
  }
}

/* ------------------------------------------------------------------ *
 * Slips by supplier
 * ------------------------------------------------------------------ */

export interface SupplierRow { name: string; slips: number; excl: number; vat: number; incl: number; credits: number; last: string }

/** One row per store, however the slip reader spelt it ("BUILDERS", "Builders " -> one). Credits count off. */
export function slipsBySupplier(expenses: Expense[]): SupplierRow[] {
  const by = new Map<string, SupplierRow>()
  for (const e of expenses) {
    const raw = (e.supplier ?? '').trim().replace(/\s+/g, ' ')
    const key = raw.toLowerCase() || '—'
    const r = by.get(key) ?? { name: raw || 'No supplier written', slips: 0, excl: 0, vat: 0, incl: 0, credits: 0, last: e.date }
    const excl = Number(e.amount_excl)
    if (excl < 0) r.credits = round2(r.credits - excl - Number(e.vat))
    else r.slips += 1
    r.excl = round2(r.excl + excl)
    r.vat = round2(r.vat + Number(e.vat))
    r.incl = round2(r.excl + r.vat)
    if (e.date > r.last) r.last = e.date
    by.set(key, r)
  }
  return [...by.values()].sort((a, b) => b.incl - a.incl)
}

/* ------------------------------------------------------------------ *
 * Returns credited
 * ------------------------------------------------------------------ */

export interface ReturnsReport {
  /** Returned in the period (by the day they went back). */
  returned: SlipReturn[]
  expected: number
  credited: number
  /** What the stores gave back short of what they should have (positive = short). */
  short: number
  /** Still waiting to go back, whenever logged. */
  waiting: { count: number; value: number }
}

export function returnsReport(returns: SlipReturn[], from: string, to: string): ReturnsReport {
  const returned = returns.filter((r) => r.status === 'returned' && inRange(r.returned_on, from, to))
    .sort((a, b) => ((a.returned_on ?? '') < (b.returned_on ?? '') ? 1 : -1))
  const expected = sum(returned, (r) => Number(r.amount_incl))
  const credited = sum(returned, (r) => Number(r.credit_amount_incl ?? r.amount_incl))
  const open = returns.filter((r) => r.status === 'to_return')
  return { returned, expected, credited, short: round2(expected - credited), waiting: { count: open.length, value: sum(open, (r) => Number(r.amount_incl)) } }
}
