import { Link } from 'react-router-dom'
import { endOfMonth, startOfDay, startOfMonth, addDays } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertCircle, Banknote, CalendarDays, Camera, FileText, FolderKanban, Receipt } from 'lucide-react'
import {
  invoices as invoicesApi,
  listEventsBetween,
  listExpensesBetween,
  listPaymentsBetween,
  listProjectFinancials,
  listQuoteTotals,
  listRecentExpenses,
  payments as paymentsApi,
  projects as projectsApi,
  quotes as quotesApi,
} from '../../../lib/api'
import { formatDate, formatDateTime, formatPct, formatZAR, formatZARShort, labelize, ymd } from '../../../lib/format'
import { outstandingInvoices } from '../../../lib/finance'
import { useLoad } from '../../../hooks/useLoad'
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatTile } from '../../../components/ui'
import { paths } from '../paths'
import { useBuild } from '../BuildContext'

async function load() {
  const now = new Date()
  const from = ymd(startOfMonth(now))
  const to = ymd(endOfMonth(now))
  const [projects, fin, quotes, totals, invoices, allPayments, monthPayments, monthExpenses, events, recent] = await Promise.all([
    projectsApi.list(),
    listProjectFinancials(),
    quotesApi.list(),
    listQuoteTotals(),
    invoicesApi.list(),
    paymentsApi.list(),
    listPaymentsBetween(from, to),
    listExpensesBetween(from, to),
    // From the start of today, so today's earlier and all-day events still show.
    listEventsBetween(startOfDay(now).toISOString(), addDays(startOfDay(now), 15).toISOString()),
    listRecentExpenses(8),
  ])
  return { projects, fin, quotes, totals, invoices, allPayments, monthPayments, monthExpenses, events, recent }
}

export function DashboardPage() {
  const { data, error, loading } = useLoad(load)
  const { needsLinking } = useBuild()

  if (loading && !data) return <Spinner />
  if (!data) return <ErrorBanner error={error} />

  const active = data.projects.filter((p) => p.status === 'active')
  const sent = data.quotes.filter((q) => q.status === 'sent')
  const sentValue = sent.reduce((s, q) => s + (data.totals.get(q.id)?.total_excl ?? 0), 0)
  const outstanding = outstandingInvoices(data.invoices, data.allPayments)
  const outstandingTotal = outstanding.reduce((s, o) => s + o.outstanding, 0)
  const income = data.monthPayments.reduce((s, p) => s + p.amount, 0)
  const spend = data.monthExpenses.reduce((s, e) => s + e.amount_excl + e.vat, 0)
  const projectName = new Map(data.projects.map((p) => [p.id, p.name]))

  const profitData = active.map((p) => {
    const f = data.fin.get(p.id)
    return { name: p.code || p.name.slice(0, 14), profit: f?.gross_profit ?? 0, full: p.name }
  })

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${active.length} active project${active.length === 1 ? '' : 's'}`}
        actions={
          <>
            <Link to={paths.capture()} className="hidden items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-slate-950 hover:bg-brand-400 sm:inline-flex">
              <Camera size={16} /> Snap slip
            </Link>
            <Link to={`${paths.quotes()}?new=1`} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800">
              <FileText size={16} /> New quote
            </Link>
          </>
        }
      />
      <ErrorBanner error={error} />

      {needsLinking > 0 && (
        <Link to={paths.bank()} className="mb-4 flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 hover:bg-brand-100">
          <Banknote size={18} className="shrink-0 text-brand-600" />
          <span className="flex-1">
            <strong>{needsLinking}</strong> bank transaction{needsLinking === 1 ? '' : 's'} need{needsLinking === 1 ? 's' : ''} linking to an expense or payment.
          </span>
          <span className="font-medium">Reconcile →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active projects" value={active.length} icon={<FolderKanban size={16} />} />
        <StatTile label="Quotes out" value={formatZAR(sentValue, { decimals: 0 })} hint={`${sent.length} sent, excl. VAT`} icon={<FileText size={16} />} />
        <StatTile label="Owed to us" value={formatZAR(outstandingTotal, { decimals: 0 })} hint={`${outstanding.length} unpaid invoice${outstanding.length === 1 ? '' : 's'}`} tone={outstanding.some((o) => o.daysOverdue > 0) ? 'bad' : 'default'} icon={<AlertCircle size={16} />} />
        <StatTile
          label="This month"
          value={formatZAR(income - spend, { decimals: 0 })}
          tone={income - spend >= 0 ? 'good' : 'bad'}
          hint={<span>In {formatZAR(income, { decimals: 0 })} · Out {formatZAR(spend, { decimals: 0 })}</span>}
          icon={<Receipt size={16} />}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Profit per active project" className="lg:col-span-2">
          {profitData.length === 0 ? (
            <EmptyState title="No active projects">Projects marked active show their gross profit here.</EmptyState>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={profitData} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={formatZARShort} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={60} />
                  <Tooltip formatter={(v) => formatZAR(Number(v))} labelFormatter={(_l, p) => p?.[0]?.payload?.full ?? ''} />
                  <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                    {profitData.map((d) => <Cell key={d.full} fill={d.profit >= 0 ? '#059669' : '#dc2626'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Coming up" actions={<Link to={paths.diary()} className="text-xs text-slate-500 hover:text-slate-800">Diary →</Link>} padded={false}>
          {data.events.length === 0 ? (
            <EmptyState title="Nothing in the next two weeks" icon={<CalendarDays size={28} />} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.events.slice(0, 7).map((e) => (
                <li key={e.id} className="px-4 py-2.5">
                  <p className="text-sm font-medium text-slate-800">{e.title}</p>
                  <p className="text-xs text-slate-500">
                    {e.all_day ? formatDate(e.start_at) : formatDateTime(e.start_at)} · {labelize(e.type)}
                    {e.project_id && projectName.get(e.project_id) ? ` · ${projectName.get(e.project_id)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Active projects" padded={false} actions={<Link to={paths.projects()} className="text-xs text-slate-500 hover:text-slate-800">All →</Link>}>
          {active.length === 0 ? (
            <EmptyState title="No active projects" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {active.map((p) => {
                const f = data.fin.get(p.id)
                return (
                  <li key={p.id}>
                    <Link to={paths.project(p.id)} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{p.name}</span>
                        <span className="block text-xs text-slate-500">{p.code ?? ''} {p.site_address ? `· ${p.site_address}` : ''}</span>
                      </span>
                      <span className="tabular shrink-0 text-right text-sm">
                        <span className={f && f.gross_profit < 0 ? 'text-red-600' : 'text-slate-800'}>{formatZAR(f?.gross_profit ?? 0, { decimals: 0 })}</span>
                        <span className="block text-xs text-slate-500">{formatPct(f?.margin_pct)} margin</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card title="Recent expenses" padded={false} actions={<Link to={paths.expenses()} className="text-xs text-slate-500 hover:text-slate-800">All →</Link>}>
          {data.recent.length === 0 ? (
            <EmptyState title="No expenses yet">Snap a slip to record your first one.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recent.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-800">{e.supplier || e.description || labelize(e.category)}</span>
                    <span className="block text-xs text-slate-500">
                      {formatDate(e.date)} · {labelize(e.category)} · {e.project_id ? projectName.get(e.project_id) ?? 'Project' : 'Overhead'}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-medium">{formatZAR(e.amount_excl + e.vat)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
