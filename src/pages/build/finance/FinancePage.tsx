import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { eachMonthOfInterval, format, parseISO } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import {
  clientLabel,
  invoices as invoicesApi,
  listExpensesBetween,
  listLinkedExpenseIds,
  listPaymentsBetween,
  listProjectFinancials,
  loadClientDirectory,
  payments as paymentsApi,
  projects as projectsApi,
} from '../../../lib/api'
import { formatDate, formatPct, formatZAR, formatZARShort, labelize } from '../../../lib/format'
import { AGEING_BUCKETS, outstandingInvoices } from '../../../lib/finance'
import { exportExpensesCsv } from '../../../lib/csvExport'
import { PERIOD_LABELS, periodRange, type PeriodKey } from '../../../lib/period'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatTile, Table, td, th } from '../../../components/ui'
import { EXPENSE_CATEGORIES } from '../../../types'
import { paths } from '../paths'

const YMD = /^\d{4}-\d{2}-\d{2}$/

function isValidRange(from: string, to: string): boolean {
  return YMD.test(from) && YMD.test(to) && !Number.isNaN(parseISO(from).getTime()) && !Number.isNaN(parseISO(to).getTime()) && from <= to
}

const PIE_COLORS = ['#f59e0b', '#0f172a', '#64748b', '#d97706', '#94a3b8', '#b45309', '#334155', '#cbd5e1']

export function FinancePage() {
  const [period, setPeriod] = useState<PeriodKey>('this_fy')
  // What's typed in the custom date inputs, and the last valid range taken from them. An empty or
  // inverted range is ignored (the page keeps showing the last good one) with a hint.
  const [customInput, setCustomInput] = useState(() => periodRange('this_month'))
  const [custom, setCustom] = useState(customInput)
  const customValid = isValidRange(customInput.from, customInput.to)
  const range = period === 'custom' ? custom : periodRange(period)
  function editCustom(next: { from: string; to: string }) {
    setCustomInput(next)
    if (isValidRange(next.from, next.to)) setCustom(next)
  }

  const { data, error, loading } = useLoad(async () => {
    const [exp, pay, projects, fin, invoices, allPayments, dir, linked] = await Promise.all([
      listExpensesBetween(range.from, range.to),
      listPaymentsBetween(range.from, range.to),
      projectsApi.list(),
      listProjectFinancials(),
      invoicesApi.list(),
      paymentsApi.list(),
      loadClientDirectory(),
      listLinkedExpenseIds(),
    ])
    return { exp, pay, projects, fin, invoices, allPayments, dir, linked }
  }, [range.from, range.to])

  const calc = useMemo(() => {
    if (!data) return null
    // Cash view: payments received (incl. VAT) vs expenses paid out (incl. VAT), plus the excl.-VAT
    // view that drives profit.
    const income = data.pay.reduce((s, p) => s + p.amount, 0)
    const expIncl = data.exp.reduce((s, e) => s + e.amount_excl + e.vat, 0)
    const expExcl = data.exp.reduce((s, e) => s + e.amount_excl, 0)
    const overheads = data.exp.filter((e) => !e.project_id).reduce((s, e) => s + e.amount_excl, 0)
    const vatPaid = data.exp.reduce((s, e) => s + e.vat, 0)

    const byCat = EXPENSE_CATEGORIES.map((c) => ({ name: labelize(c), value: data.exp.filter((e) => e.category === c).reduce((s, e) => s + e.amount_excl, 0) })).filter((x) => x.value > 0)

    const months = eachMonthOfInterval({ start: parseISO(range.from), end: parseISO(range.to) }).map((m) => {
      const key = format(m, 'yyyy-MM')
      return {
        month: format(m, 'MMM yy'),
        Income: data.pay.filter((p) => p.date.startsWith(key)).reduce((s, p) => s + p.amount, 0),
        Expenses: data.exp.filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.amount_excl + e.vat, 0),
      }
    })

    const perProject = data.projects
      .filter((p) => p.status !== 'cancelled' && p.status !== 'lead')
      .map((p) => {
        const inPeriodSpend = data.exp.filter((e) => e.project_id === p.id).reduce((s, e) => s + e.amount_excl, 0)
        const inPeriodReceived = data.pay.filter((x) => x.project_id === p.id).reduce((s, x) => s + x.amount, 0)
        return { p, f: data.fin.get(p.id), inPeriodSpend, inPeriodReceived }
      })
      .sort((a, b) => (b.f?.gross_profit ?? 0) - (a.f?.gross_profit ?? 0))

    const outstanding = outstandingInvoices(data.invoices, data.allPayments)
    const ageing = AGEING_BUCKETS.map((b) => ({ bucket: b, total: outstanding.filter((o) => o.bucket === b).reduce((s, o) => s + o.outstanding, 0) }))
    return { income, expIncl, expExcl, overheads, vatPaid, byCat, months, perProject, outstanding, ageing }
  }, [data, range.from, range.to])

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        actions={
          <Button onClick={() => data && exportExpensesCsv(data.exp, data.projects, data.linked, `expenses-${range.from}-to-${range.to}.csv`)} disabled={!data?.exp.length}>
            <Download size={16} /> Export expenses CSV
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
        </select>
        {period === 'custom' && (
          <>
            <input type="date" className="input w-auto" value={customInput.from} onChange={(e) => editCustom({ ...customInput, from: e.target.value })} />
            <span className="text-slate-400">to</span>
            <input type="date" className="input w-auto" value={customInput.to} onChange={(e) => editCustom({ ...customInput, to: e.target.value })} />
            {!customValid && (
              <span className="text-xs text-orange-700">
                {customInput.from && customInput.to ? 'The end date is before the start date' : 'Pick both dates'} — showing {formatDate(custom.from)} – {formatDate(custom.to)}.
              </span>
            )}
          </>
        )}
      </div>
      <ErrorBanner error={error} />
      {loading && !data ? <Spinner /> : calc && data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Income received" value={formatZAR(calc.income, { decimals: 0 })} hint="Payments, incl. VAT" tone="good" />
            <StatTile label="Expenses" value={formatZAR(calc.expIncl, { decimals: 0 })} hint={`${formatZAR(calc.overheads, { decimals: 0 })} overheads (excl.)`} />
            <StatTile label="Net cash" value={formatZAR(calc.income - calc.expIncl, { decimals: 0 })} tone={calc.income - calc.expIncl >= 0 ? 'good' : 'bad'} hint="Income − expenses" />
            <StatTile label="Input VAT paid" value={formatZAR(calc.vatPaid, { decimals: 0 })} hint="Claimable on expenses" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Income vs expenses by month" className="lg:col-span-2">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={calc.months} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={formatZARShort} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={60} />
                    <Tooltip formatter={(v) => formatZAR(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Income" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Expenses" fill="#334155" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Expenses by category (excl. VAT)">
              {calc.byCat.length === 0 ? <EmptyState title="No expenses in this period" /> : (
                <>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={calc.byCat} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                          {calc.byCat.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => formatZAR(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {calc.byCat.map((c, i) => (
                      <li key={c.name} className="flex items-center justify-between">
                        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />{c.name}</span>
                        <span className="tabular">{formatZAR(c.value)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          <Card title="Profit per project" padded={false}>
            <Table>
              <thead>
                <tr>
                  <th className={th}>Project</th>
                  <th className={`${th} text-right`}>Revised contract</th>
                  <th className={`${th} text-right`}>Spent (all time)</th>
                  <th className={`${th} text-right`}>Gross profit</th>
                  <th className={`${th} text-right`}>Margin</th>
                  <th className={`${th} text-right`}>Spent in period</th>
                  <th className={`${th} text-right`}>Received in period</th>
                </tr>
              </thead>
              <tbody>
                {calc.perProject.map(({ p, f, inPeriodSpend, inPeriodReceived }) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className={td}><Link to={paths.project(p.id)} className="font-medium text-slate-800 hover:text-amber-700">{p.name}</Link><span className="block text-xs text-slate-500">{labelize(p.status)}</span></td>
                    <td className={`${td} tabular text-right`}>{formatZAR(f?.revised_contract ?? 0)}</td>
                    <td className={`${td} tabular text-right`}>{formatZAR(f?.expenses_total ?? 0)}</td>
                    <td className={`${td} tabular text-right font-medium ${(f?.gross_profit ?? 0) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatZAR(f?.gross_profit ?? 0)}</td>
                    <td className={`${td} tabular text-right`}>{formatPct(f?.margin_pct)}</td>
                    <td className={`${td} tabular text-right text-slate-600`}>{formatZAR(inPeriodSpend)}</td>
                    <td className={`${td} tabular text-right text-slate-600`}>{formatZAR(inPeriodReceived)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card title="Outstanding invoices" padded={false}>
            <div className="grid grid-cols-2 gap-2 border-b border-slate-100 p-4 sm:grid-cols-5">
              {calc.ageing.map((a) => (
                <div key={a.bucket} className={`rounded-lg p-2.5 ${a.bucket === 'Current' ? 'bg-slate-50' : a.total > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                  <p className="text-xs text-slate-500">{a.bucket}</p>
                  <p className={`tabular text-sm font-semibold ${a.bucket !== 'Current' && a.total > 0 ? 'text-red-700' : 'text-slate-800'}`}>{formatZAR(a.total, { decimals: 0 })}</p>
                </div>
              ))}
            </div>
            {calc.outstanding.length === 0 ? <EmptyState title="Nothing outstanding" /> : (
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Invoice</th>
                    <th className={th}>Client</th>
                    <th className={th}>Due</th>
                    <th className={`${th} text-right`}>Total</th>
                    <th className={`${th} text-right`}>Outstanding</th>
                    <th className={th}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {calc.outstanding.map((o) => (
                    <tr key={o.invoice.id}>
                      <td className={td}>
                        {o.invoice.project_id ? <Link className="font-mono text-xs hover:text-amber-700" to={paths.project(o.invoice.project_id, 'invoices')}>{o.invoice.number}</Link> : <span className="font-mono text-xs">{o.invoice.number}</span>}
                      </td>
                      <td className={td}>{clientLabel(data.dir, o.invoice)}</td>
                      <td className={td}>{formatDate(o.invoice.due_date)}</td>
                      <td className={`${td} tabular text-right`}>{formatZAR(o.total)}</td>
                      <td className={`${td} tabular text-right font-medium`}>{formatZAR(o.outstanding)}</td>
                      <td className={`${td} ${o.daysOverdue > 0 ? 'text-red-600' : 'text-slate-500'}`}>{o.daysOverdue > 0 ? `${o.daysOverdue} days overdue` : 'Current'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
