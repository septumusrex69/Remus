import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseISO } from 'date-fns'
import { Download, Printer, ScrollText } from 'lucide-react'
import {
  clientLabel, invoices as invoicesApi, listCrewDays, listExpensesBetween, listQuoteTotals, loadClientDirectory,
  payments as paymentsApi, projects as projectsApi, projectStages, quotes as quotesApi, slipReturns, stageBookings, workers as workersApi,
} from '../../../lib/api'
import { formatDate, formatZAR, ymd } from '../../../lib/format'
import { AGEING_BUCKETS } from '../../../lib/finance'
import { downloadCsv } from '../../../lib/csvExport'
import { PERIOD_LABELS, periodRange, type PeriodKey } from '../../../lib/period'
import { crewSources } from '../../../lib/projectScores'
import {
  crewReport, jobVersusOverhead, outstandingByClient, overheadsByKind, profitPerJob, quotesReport, QUOTE_STATUS_WORDS,
  returnsReport, slipsBySupplier, spendByCategory, type SpendRow,
} from '../../../lib/reports'
import { statementClientFor } from '../../../lib/statement'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatTile, Table, Tabs, td, th } from '../../../components/ui'
import { StatementModal, type StatementClient } from '../../../components/statement/StatementActions'
import { paths } from '../paths'

/**
 * REPORTS (Remus · Handover 8). Stephan, 7 Nov, of the reports a builder needs: "we can start with pretty much all
 * of that."
 *
 * RAPTOR'S REPORTS PAGE (src/pages/reports/ReportsPage.tsx), kept in shape: one page, the period picked at the top,
 * a tab per report (?tab= links), figures in tiles over the detail. Its reports are a sales firm's (leads, pipeline,
 * deals); these are a builder's, worked out in lib/reports.ts. Money, so Administrators and Read-only only
 * (lib/access.ts seesMoney; the route and the sidebar both say so).
 *
 * DIFFERENT FROM RAPTOR, and why: every report here prints and exports to CSV (Stephan's ask; Raptor's reports do
 * neither), so each one is a table first and a picture second; and the period is Finance's picker (lib/period.ts,
 * the SA tax year included) instead of Raptor's sales month, which a builder does not have.
 */

type ReportTab = 'profit' | 'spending' | 'outstanding' | 'quotes' | 'crew' | 'suppliers' | 'returns'
const TABS: { id: ReportTab; label: string }[] = [
  { id: 'profit', label: 'Profit per job' },
  { id: 'spending', label: 'Spending' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'quotes', label: 'Quotes won & lost' },
  { id: 'crew', label: 'Crew & wages' },
  { id: 'suppliers', label: 'Slips by supplier' },
  { id: 'returns', label: 'Returns' },
]

const YMD = /^\d{4}-\d{2}-\d{2}$/
const validRange = (from: string, to: string) => YMD.test(from) && YMD.test(to) && !Number.isNaN(parseISO(from).getTime()) && !Number.isNaN(parseISO(to).getTime()) && from <= to
const money = (n: number) => n.toFixed(2)
const monthName = (ym: string) => formatDate(`${ym}-01`, 'MMM yyyy')

/* ------------------------------------------------------------------ *
 * One report: a table that prints and exports, the same columns both ways
 * ------------------------------------------------------------------ */

interface Col<T> { head: string; right?: boolean; cell: (r: T) => ReactNode; csv: (r: T) => string | number | null }

function ReportCard<T>({ title, subtitle, file, rows, cols, foot, empty, children }: {
  title: string
  subtitle?: ReactNode
  /** The CSV's name, without the period or .csv. */
  file: string
  rows: T[]
  cols: Col<T>[]
  /** A totals row: one value per column (null for a blank cell). A number is rand; a count goes in as a string. */
  foot?: (string | number | null)[]
  empty: string
  children?: ReactNode
}) {
  const range = useContext(RangeCtx)
  return (
    <Card title={title} subtitle={subtitle} padded={false}
      actions={<span className="no-print flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => window.print()} title="Print this report"><Printer size={14} /> Print</Button>
        <Button size="sm" disabled={rows.length === 0} data-testid={`csv-${file}`} title="Download as CSV (opens in Excel)"
          onClick={() => downloadCsv(`${file}-${range.from}-to-${range.to}.csv`, [cols.map((c) => c.head), ...rows.map((r) => cols.map((c) => c.csv(r))), ...(foot ? [foot.map((v) => (typeof v === 'number' ? money(v) : v))] : [])])}>
          <Download size={14} /> CSV
        </Button>
      </span>}>
      {children}
      {rows.length === 0 ? <EmptyState title={empty} /> : (
        <Table>
          <thead><tr>{cols.map((c) => <th key={c.head} className={`${th} ${c.right ? 'text-right' : ''}`}>{c.head}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i} className="print-avoid-break">{cols.map((c) => <td key={c.head} className={`${td} ${c.right ? 'tabular text-right' : ''}`}>{c.cell(r)}</td>)}</tr>)}
          </tbody>
          {foot && <tfoot><tr>{foot.map((v, i) => <td key={i} className={`${td} font-semibold ${cols[i]?.right ? 'tabular text-right' : ''}`}>{typeof v === 'number' ? formatZAR(v) : v}</td>)}</tr></tfoot>}
        </Table>
      )}
    </Card>
  )
}

/* The period reaches every card's CSV name without threading it through each report. */
const RangeCtx = createContext({ from: '', to: '' })

function Bars({ rows }: { rows: SpendRow[] }) {
  const top = Math.max(1, ...rows.map((r) => r.excl))
  return (
    <ul className="space-y-1.5 border-b border-slate-100 p-4 text-sm">
      {rows.map((k) => (
        <li key={k.name}>
          <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate">{k.name}</span><span className="tabular">{formatZAR(k.excl)}</span></div>
          <div className="mt-0.5 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(2, (Math.max(0, k.excl) / top) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

const spendCols: Col<SpendRow>[] = [
  { head: 'Kind', cell: (r) => r.name, csv: (r) => r.name },
  { head: 'Slips', right: true, cell: (r) => r.count, csv: (r) => r.count },
  { head: 'Excl. VAT', right: true, cell: (r) => formatZAR(r.excl), csv: (r) => money(r.excl) },
  { head: 'VAT', right: true, cell: (r) => formatZAR(r.vat), csv: (r) => money(r.vat) },
  { head: 'Incl. VAT', right: true, cell: (r) => formatZAR(r.incl), csv: (r) => money(r.incl) },
]
const spendFoot = (rows: SpendRow[]) => ['Total', String(rows.reduce((s, r) => s + r.count, 0)),...(['excl', 'vat', 'incl'] as const).map((k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100)]

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

export function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab') as ReportTab | null
  const tab: ReportTab = TABS.some((t) => t.id === asked) ? asked! : 'profit'
  const setTab = (t: ReportTab) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })

  const [period, setPeriod] = useState<PeriodKey>('this_fy')
  const [customInput, setCustomInput] = useState(() => periodRange('this_month'))
  const [custom, setCustom] = useState(customInput)
  const range = period === 'custom' ? custom : periodRange(period)
  const today = ymd(new Date())
  const [statementFor, setStatementFor] = useState<StatementClient | null>(null)

  const { data, error, loading } = useLoad(async () => {
    const [projects, invoices, payments, expenses, quotes, totals, dir, returns, stages, bookings, workers, register] = await Promise.all([
      projectsApi.list(),
      invoicesApi.list(),
      paymentsApi.list(),
      listExpensesBetween(range.from, range.to),
      quotesApi.list(),
      listQuoteTotals(),
      loadClientDirectory(),
      slipReturns.list().catch(() => []),
      projectStages.list().catch(() => []),
      stageBookings.list().catch(() => []),
      workersApi.list().catch(() => []),
      listCrewDays(range.from, range.to).catch(() => []),
    ])
    return { projects, invoices, payments, expenses, quotes, totals, dir, returns, crew: crewSources(stages, bookings, workers, register) }
  }, [range.from, range.to], 'reports')

  const projectName = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.id, `${p.code ? `${p.code} ` : ''}${p.name}`])), [data])

  return (
    <RangeCtx.Provider value={range}>
    <div>
      <PageHeader title="Reports" subtitle={`${formatDate(range.from)} – ${formatDate(range.to)}`} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} aria-label="Period" data-testid="reports-period">
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
        </select>
        {period === 'custom' && (
          <>
            <input type="date" className="input w-auto" value={customInput.from} onChange={(e) => { const n = { ...customInput, from: e.target.value }; setCustomInput(n); if (validRange(n.from, n.to)) setCustom(n) }} />
            <span className="text-slate-400">to</span>
            <input type="date" className="input w-auto" value={customInput.to} onChange={(e) => { const n = { ...customInput, to: e.target.value }; setCustomInput(n); if (validRange(n.from, n.to)) setCustom(n) }} />
            {!validRange(customInput.from, customInput.to) && <span className="text-xs text-orange-700">Pick both dates, the end after the start.</span>}
          </>
        )}
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <ErrorBanner error={error} />
      {loading && !data ? <Spinner /> : data && (
        <div className="space-y-4" data-testid={`report-${tab}`}>
          {tab === 'profit' && (() => {
            const rows = profitPerJob({ projects: data.projects, invoices: data.invoices, expenses: data.expenses, crew: data.crew, from: range.from, to: range.to, today })
            const t = (k: 'invoiced' | 'slips' | 'crew' | 'profit') => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100
            const over = jobVersusOverhead(data.expenses).overheads
            return <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Invoiced" value={formatZAR(t('invoiced'), { decimals: 0 })} hint="Excl. VAT, in the period" />
                <StatTile label="Job costs" value={formatZAR(t('slips') + t('crew'), { decimals: 0 })} hint={`${formatZAR(t('crew'), { decimals: 0 })} of it crew`} />
                <StatTile label="Profit from jobs" value={formatZAR(t('profit'), { decimals: 0 })} tone={t('profit') >= 0 ? 'good' : 'bad'} />
                <StatTile label="After overheads" value={formatZAR(t('profit') - over, { decimals: 0 })} hint={`${formatZAR(over, { decimals: 0 })} overheads`} tone={t('profit') - over >= 0 ? 'good' : 'bad'} />
              </div>
              <ReportCard title="Profit per job" subtitle="Invoiced in the period, less the job's slips and its crew days (all excl. VAT)." file="profit-per-job" empty="No job had anything invoiced or spent in this period"
                rows={rows}
                cols={[
                  { head: 'Job', cell: (r) => <Link to={paths.project(r.project.id)} className="font-medium hover:text-brand-700">{projectName.get(r.project.id)}</Link>, csv: (r) => projectName.get(r.project.id) ?? '' },
                  { head: 'Contract', right: true, cell: (r) => formatZAR(r.contract), csv: (r) => money(r.contract) },
                  { head: 'Invoiced', right: true, cell: (r) => formatZAR(r.invoiced), csv: (r) => money(r.invoiced) },
                  { head: 'Slips', right: true, cell: (r) => formatZAR(r.slips), csv: (r) => money(r.slips) },
                  { head: 'Crew', right: true, cell: (r) => formatZAR(r.crew), csv: (r) => money(r.crew) },
                  { head: 'Profit', right: true, cell: (r) => <span className={r.profit < 0 ? 'text-red-600' : 'text-emerald-700'}>{formatZAR(r.profit)}</span>, csv: (r) => money(r.profit) },
                  { head: 'Margin', right: true, cell: (r) => (r.margin === null ? '—' : `${r.margin}%`), csv: (r) => r.margin },
                ]}
                foot={['Total', null, t('invoiced'), t('slips'), t('crew'), t('profit'), null]} />
            </>
          })()}

          {tab === 'spending' && (() => {
            const cats = spendByCategory(data.expenses)
            const kinds = overheadsByKind(data.expenses)
            const split = jobVersusOverhead(data.expenses)
            return <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatTile label="On jobs" value={formatZAR(split.jobs, { decimals: 0 })} hint="Excl. VAT" />
                <StatTile label="Overheads" value={formatZAR(split.overheads, { decimals: 0 })} hint="Slips on no job" />
                <StatTile label="Overheads on job costs" value={split.jobs > 0 ? `${Math.round((split.overheads / split.jobs) * 1000) / 10}%` : '—'} hint="What a quote must add on cost to carry them" />
              </div>
              <ReportCard title="Spending by category" subtitle="Every slip in the period (a return's credit counts off)." file="spend-by-category" rows={cats} cols={spendCols} foot={spendFoot(cats)} empty="No slips in this period">
                {cats.length > 0 && <Bars rows={cats} />}
              </ReportCard>
              <ReportCard title="Overheads by kind" subtitle="Slips on no job, by what they were for." file="overheads-by-kind" rows={kinds} cols={spendCols} foot={spendFoot(kinds)} empty="No overheads in this period">
                {kinds.length > 0 && <Bars rows={kinds} />}
              </ReportCard>
            </>
          })()}

          {tab === 'outstanding' && (() => {
            const rows = outstandingByClient(data.invoices, data.payments, (r) => clientLabel(data.dir, r))
            const total = (b?: (typeof AGEING_BUCKETS)[number]) => Math.round(rows.reduce((s, r) => s + (b ? r.buckets[b] : r.total), 0) * 100) / 100
            return <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Owed to us" value={formatZAR(total(), { decimals: 0 })} hint={`${rows.length} client${rows.length === 1 ? '' : 's'}`} />
                <StatTile label="Overdue" value={formatZAR(total() - total('Current'), { decimals: 0 })} tone={total() - total('Current') > 0 ? 'bad' : 'default'} />
                <StatTile label="Over 60 days" value={formatZAR(total('61–90 days') + total('90+ days'), { decimals: 0 })} tone={total('61–90 days') + total('90+ days') > 0 ? 'bad' : 'default'} />
                <StatTile label="Not yet due" value={formatZAR(total('Current'), { decimals: 0 })} />
              </div>
              <ReportCard title="Outstanding by client" subtitle={`What each client owes today, by how late (not limited to the period). As at ${formatDate(today)}.`} file="outstanding-by-client" empty="Nothing outstanding"
                rows={rows}
                cols={[
                  { head: 'Client', cell: (r) => (r.kind === 'none' ? r.name : <Link to={r.kind === 'company' ? paths.company(r.id!) : paths.contact(r.id!)} className="font-medium hover:text-brand-700">{r.name}</Link>), csv: (r) => r.name },
                  { head: 'Invoices', right: true, cell: (r) => r.invoices, csv: (r) => r.invoices },
                  ...AGEING_BUCKETS.map((b) => ({ head: b, right: true, cell: (r: (typeof rows)[number]) => <span className={b !== 'Current' && r.buckets[b] > 0 ? 'text-red-600' : ''}>{formatZAR(r.buckets[b])}</span>, csv: (r: (typeof rows)[number]) => money(r.buckets[b]) })),
                  { head: 'Total', right: true, cell: (r) => <span className="font-semibold">{formatZAR(r.total)}</span>, csv: (r) => money(r.total) },
                  {
                    head: 'Statement', cell: (r) => {
                      if (r.kind === 'none') return null
                      const company = r.kind === 'company' ? data.dir.companyById.get(r.id!) : null
                      const contact = r.kind === 'contact' ? data.dir.contactById.get(r.id!) : null
                      if (!company && !contact) return null
                      return <Button size="sm" variant="ghost" className="no-print" onClick={() => setStatementFor(company ? statementClientFor('company', company, data.dir.contacts.filter((c) => c.company_id === company.id)) : statementClientFor('contact', contact!))}><ScrollText size={14} /> Statement</Button>
                    }, csv: () => null,
                  },
                ]}
                foot={['Total', String(rows.reduce((s, r) => s + r.invoices, 0)),...AGEING_BUCKETS.map((b) => total(b)), total(), null]} />
            </>
          })()}

          {tab === 'quotes' && (() => {
            const r = quotesReport(data.quotes, data.totals, range.from, range.to)
            const value = (id: string) => Number(data.totals.get(id)?.total_excl ?? 0)
            return <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Quotes in the period" value={String(r.quotes.length)} />
                <StatTile label="Won" value={formatZAR(r.wonValue, { decimals: 0 })} hint={`${r.rows.find((x) => x.status === 'accepted')!.count} quotes`} tone="good" />
                <StatTile label="Lost or expired" value={formatZAR(r.lostValue, { decimals: 0 })} hint={`${r.rows.filter((x) => x.status === 'declined' || x.status === 'expired').reduce((s, x) => s + x.count, 0)} quotes`} />
                <StatTile label="Win rate" value={r.winRate === null ? '—' : `${r.winRate}%`} hint="Of the quotes decided" tone="accent" />
              </div>
              <ReportCard title="Where the quotes stand" subtitle="Quotes dated in the period, excl. VAT." file="quotes-by-status" empty="No quotes" rows={r.rows}
                cols={[
                  { head: 'Status', cell: (x) => x.label, csv: (x) => x.label },
                  { head: 'Quotes', right: true, cell: (x) => x.count, csv: (x) => x.count },
                  { head: 'Value', right: true, cell: (x) => formatZAR(x.value), csv: (x) => money(x.value) },
                ]} />
              <ReportCard title="Every quote" file="quotes" empty="No quotes dated in this period" rows={r.quotes}
                cols={[
                  { head: 'Quote', cell: (q) => <Link to={paths.quote(q.id)} className="hover:text-brand-700"><span className="font-mono text-xs text-slate-400">{q.number}</span> {q.title}</Link>, csv: (q) => `${q.number ?? ''} ${q.title}`.trim() },
                  { head: 'Client', cell: (q) => clientLabel(data.dir, q), csv: (q) => clientLabel(data.dir, q) },
                  { head: 'Dated', cell: (q) => formatDate(q.issue_date), csv: (q) => q.issue_date },
                  { head: 'Status', cell: (q) => QUOTE_STATUS_WORDS[q.status], csv: (q) => QUOTE_STATUS_WORDS[q.status] },
                  { head: 'Value', right: true, cell: (q) => formatZAR(value(q.id)), csv: (q) => money(value(q.id)) },
                ]} />
            </>
          })()}

          {tab === 'crew' && (() => {
            const r = crewReport(data.crew, range.from, range.to, today)
            const days = r.byWorker.reduce((s, w) => s + w.days, 0)
            const wages = Math.round(r.byWorker.reduce((s, w) => s + w.wages, 0) * 100) / 100
            const unconfirmed = r.byWorker.reduce((s, w) => s + w.unconfirmedDays, 0)
            return <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatTile label="Crew days" value={String(days)} hint={unconfirmed ? `${unconfirmed} only booked, not confirmed` : 'All from the register'} />
                <StatTile label="Wages" value={formatZAR(wages, { decimals: 0 })} />
                <StatTile label="People" value={String(r.byWorker.length)} />
              </div>
              <ReportCard title="Crew days and wages per job, per month" subtitle="From the crew register; a booked day nobody confirmed still counts, marked." file="crew-per-job-month" empty="No crew days in this period"
                rows={r.byJobMonth}
                cols={[
                  { head: 'Month', cell: (x) => monthName(x.month), csv: (x) => x.month },
                  { head: 'Job', cell: (x) => <Link to={paths.project(x.projectId)} className="hover:text-brand-700">{projectName.get(x.projectId) ?? 'A job'}</Link>, csv: (x) => projectName.get(x.projectId) ?? '' },
                  { head: 'Days', right: true, cell: (x) => <>{x.days}{x.unconfirmedDays > 0 && <span className="ml-1 text-xs text-orange-700">({x.unconfirmedDays} not confirmed)</span>}</>, csv: (x) => x.days },
                  { head: 'Wages', right: true, cell: (x) => formatZAR(x.wages), csv: (x) => money(x.wages) },
                ]}
                foot={['Total', null, String(days), wages]} />
              <ReportCard title="Per person" file="crew-per-person" empty="No crew days in this period" rows={r.byWorker}
                cols={[
                  { head: 'Person', cell: (w) => w.name, csv: (w) => w.name },
                  { head: 'Jobs', right: true, cell: (w) => w.jobs, csv: (w) => w.jobs },
                  { head: 'Days', right: true, cell: (w) => w.days, csv: (w) => w.days },
                  { head: 'Not confirmed', right: true, cell: (w) => w.unconfirmedDays || '—', csv: (w) => w.unconfirmedDays },
                  { head: 'Wages', right: true, cell: (w) => formatZAR(w.wages), csv: (w) => money(w.wages) },
                ]}
                foot={['Total', null, String(days), String(unconfirmed), wages]} />
            </>
          })()}

          {tab === 'suppliers' && (() => {
            const rows = slipsBySupplier(data.expenses)
            const t = (k: 'excl' | 'vat' | 'incl' | 'credits') => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100
            return (
              <ReportCard title="Slips by supplier" subtitle="Every slip in the period, one row per store. Credits are returns the store refunded." file="slips-by-supplier" empty="No slips in this period"
                rows={rows}
                cols={[
                  { head: 'Supplier', cell: (r) => r.name, csv: (r) => r.name },
                  { head: 'Slips', right: true, cell: (r) => r.slips, csv: (r) => r.slips },
                  { head: 'Last slip', cell: (r) => formatDate(r.last), csv: (r) => r.last },
                  { head: 'Excl. VAT', right: true, cell: (r) => formatZAR(r.excl), csv: (r) => money(r.excl) },
                  { head: 'VAT', right: true, cell: (r) => formatZAR(r.vat), csv: (r) => money(r.vat) },
                  { head: 'Incl. VAT', right: true, cell: (r) => <span className="font-medium">{formatZAR(r.incl)}</span>, csv: (r) => money(r.incl) },
                  { head: 'Credits', right: true, cell: (r) => (r.credits ? <span className="text-emerald-700">{formatZAR(r.credits)}</span> : '—'), csv: (r) => money(r.credits) },
                ]}
                foot={['Total', String(rows.reduce((s, r) => s + r.slips, 0)), null, t('excl'), t('vat'), t('incl'), t('credits')]} />
            )
          })()}

          {tab === 'returns' && (() => {
            const r = returnsReport(data.returns, range.from, range.to)
            return <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Returned" value={String(r.returned.length)} hint="In the period" />
                <StatTile label="Credited" value={formatZAR(r.credited, { decimals: 0 })} tone="good" />
                <StatTile label="Short" value={formatZAR(r.short, { decimals: 0 })} hint="Less than the store should have given" tone={r.short > 0 ? 'bad' : 'default'} />
                <StatTile label="Still to take back" value={String(r.waiting.count)} hint={formatZAR(r.waiting.value, { decimals: 0 })} />
              </div>
              <ReportCard title="Returns credited" subtitle="Goods taken back to the store in the period, and what the store gave back (incl. VAT)." file="returns-credited" empty="Nothing went back in this period"
                rows={r.returned}
                cols={[
                  { head: 'Returned', cell: (x) => formatDate(x.returned_on), csv: (x) => x.returned_on },
                  { head: 'Supplier', cell: (x) => x.supplier ?? '—', csv: (x) => x.supplier },
                  { head: 'Slip', cell: (x) => x.receipt_number ?? '—', csv: (x) => x.receipt_number },
                  { head: 'Job', cell: (x) => (x.project_id ? projectName.get(x.project_id) ?? '' : 'Overheads'), csv: (x) => (x.project_id ? projectName.get(x.project_id) ?? '' : 'Overheads') },
                  { head: 'Credit note', cell: (x) => x.credit_number ?? '—', csv: (x) => x.credit_number },
                  { head: 'Should give', right: true, cell: (x) => formatZAR(x.amount_incl), csv: (x) => money(Number(x.amount_incl)) },
                  { head: 'Credited', right: true, cell: (x) => <span className="text-emerald-700">{formatZAR(Number(x.credit_amount_incl ?? x.amount_incl))}</span>, csv: (x) => money(Number(x.credit_amount_incl ?? x.amount_incl)) },
                ]}
                foot={['Total', null, null, null, null, r.expected, r.credited]} />
            </>
          })()}
        </div>
      )}
      {statementFor && <StatementModal client={statementFor} onClose={() => setStatementFor(null)} />}
    </div>
    </RangeCtx.Provider>
  )
}
