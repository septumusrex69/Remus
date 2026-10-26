import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { addDays, differenceInCalendarDays, endOfMonth, format, startOfDay, startOfMonth } from 'date-fns'
import {
  AlertCircle, AlertTriangle, Camera, CheckCircle2, ChevronRight, FileText, HardHat, Receipt, Wallet,
} from 'lucide-react'
import {
  invoices as invoicesApi,
  listEventsBetween,
  listExpensesBetween,
  listPaymentsBetween,
  listProjectFinancials,
  listQuoteTotals,
  listRecentExpenses,
  loadBankBalances,
  payments as paymentsApi,
  projects as projectsApi,
  quotes as quotesApi,
} from '../../../lib/api'
import { formatDate, formatPct, formatZAR, labelize, ymd } from '../../../lib/format'
import { outstandingInvoices } from '../../../lib/finance'
import { approvalCurrent } from '../../../lib/quoteMath'
import { useLoad } from '../../../hooks/useLoad'
import { useUnreadMail } from '../../../lib/unreadMail'
import { useAuth } from '../../../store/AuthContext'
import { Card, EmptyState, ErrorBanner, Spinner, StatTile } from '../../../components/ui'
import type { DiaryEvent, Project } from '../../../types'
import { paths } from '../paths'
import { LazyProfitPerProjectChart } from '../components/LazyCharts'
import { useBuild } from '../BuildContext'

/**
 * The dashboard answers "what do we have to do?" first (Stephan, 26 Oct 2026): what is happening
 * today and tomorrow, where the next job starts, what is waiting on us, and the money (bank, owed,
 * open quotes, this month). The analysis (profit per project, recent spending) comes after.
 *
 * The hero band and "Needs attention" are Raptor's (DashboardHero, NeedsAttention), in Remus's skin.
 */

async function load() {
  const now = new Date()
  const from = ymd(startOfMonth(now))
  const to = ymd(endOfMonth(now))
  const [projects, fin, quotes, totals, invoices, allPayments, monthPayments, monthExpenses, events, recent, bank] = await Promise.all([
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
    listRecentExpenses(6),
    loadBankBalances().catch(() => null),
  ])
  return { projects, fin, quotes, totals, invoices, allPayments, monthPayments, monthExpenses, events, recent, bank }
}

/** Is the project on site that day: active, and the day inside its dates (or it has none). */
function onSite(p: Project, day: string): boolean {
  if (p.status !== 'active') return false
  return (!p.start_date || p.start_date <= day) && (!p.end_date || p.end_date >= day)
}

interface DayItem {
  key: string
  when: string
  title: string
  sub?: string
  to: string
}

export function DashboardPage() {
  const { data, error, loading } = useLoad(load, [], 'dashboard')
  const { needsLinking } = useBuild()
  const unread = useUnreadMail()
  const { currentUser } = useAuth()

  if (loading && !data) return <Spinner page />
  if (!data) return <ErrorBanner error={error} />

  const now = new Date()
  const today = ymd(now)
  const tomorrow = ymd(addDays(now, 1))
  const projectName = new Map(data.projects.map((p) => [p.id, p.name]))
  const active = data.projects.filter((p) => p.status === 'active')

  // ---------- Quotes ----------
  const quoteTotal = (id: string) => data.totals.get(id)?.total_excl ?? 0
  const live = data.quotes.filter((q) => (q.status === 'draft' || q.status === 'sent') && (!q.valid_until || q.valid_until >= today))
  const openValue = live.reduce((s, q) => s + quoteTotal(q.id), 0)
  const waitingApproval = data.quotes.filter((q) => q.status === 'draft' && quoteTotal(q.id) > 0 && !approvalCurrent(q, quoteTotal(q.id)))
  const noAnswer = data.quotes.filter((q) => q.status === 'sent' && q.sent_at && differenceInCalendarDays(now, new Date(q.sent_at)) >= 7 && (!q.valid_until || q.valid_until >= today))
  const expired = data.quotes.filter((q) => q.status === 'sent' && q.valid_until && q.valid_until < today)
  const expiringSoon = data.quotes.filter((q) => (q.status === 'sent' || q.status === 'draft') && q.valid_until && q.valid_until >= today && q.valid_until <= ymd(addDays(now, 7)))

  // ---------- Money ----------
  const outstanding = outstandingInvoices(data.invoices, data.allPayments)
  const outstandingTotal = outstanding.reduce((s, o) => s + o.outstanding, 0)
  const overdue = outstanding.filter((o) => o.daysOverdue > 0)
  const draftInvoices = data.invoices.filter((i) => i.status === 'draft')
  const income = data.monthPayments.reduce((s, p) => s + p.amount, 0)
  const spend = data.monthExpenses.reduce((s, e) => s + e.amount_excl + e.vat, 0)

  // ---------- Next job ----------
  const upcoming = data.projects
    .filter((p) => (p.status === 'planned' || p.status === 'active') && p.start_date && p.start_date > today)
    .sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))
  const next = upcoming[0] ?? null
  const plannedNoDate = data.projects.filter((p) => p.status === 'planned' && !p.start_date)

  // ---------- Today and tomorrow ----------
  function dayItems(day: string): DayItem[] {
    const items: DayItem[] = []
    for (const e of data!.events.filter((ev: DiaryEvent) => ymd(new Date(ev.start_at)) === day)) {
      items.push({
        key: `e:${e.id}`,
        when: e.all_day ? 'All day' : format(new Date(e.start_at), 'HH:mm'),
        title: e.title,
        sub: [labelize(e.type), e.project_id ? projectName.get(e.project_id) : null, e.location].filter(Boolean).join(' · '),
        to: paths.diary(),
      })
    }
    for (const p of data!.projects.filter((x) => x.start_date === day && (x.status === 'planned' || x.status === 'active'))) {
      items.push({ key: `s:${p.id}`, when: 'Starts', title: p.name, sub: p.site_address ?? undefined, to: paths.project(p.id) })
    }
    for (const p of data!.projects.filter((x) => x.end_date === day && x.status === 'active')) {
      items.push({ key: `f:${p.id}`, when: 'Due to finish', title: p.name, sub: p.site_address ?? undefined, to: paths.project(p.id) })
    }
    for (const q of data!.quotes.filter((x) => (x.status === 'sent' || x.status === 'draft') && x.valid_until === day)) {
      items.push({ key: `q:${q.id}`, when: 'Quote expires', title: `${q.number ?? ''} ${q.title}`.trim(), to: paths.quote(q.id) })
    }
    for (const o of outstanding.filter((x) => x.invoice.due_date === day)) {
      items.push({ key: `i:${o.invoice.id}`, when: 'Invoice due', title: `${o.invoice.number ?? 'Invoice'} · ${formatZAR(o.outstanding, { decimals: 0 })}`, to: paths.finance() })
    }
    return items
  }
  const sitesToday = data.projects.filter((p) => onSite(p, today))
  const sitesTomorrow = data.projects.filter((p) => onSite(p, tomorrow))
  const later = data.events.filter((e) => ymd(new Date(e.start_at)) > tomorrow).slice(0, 5)

  // ---------- Needs attention ----------
  const attention: AttentionItem[] = [
    { label: overdue.length === 1 ? 'invoice overdue' : 'invoices overdue', detail: 'Chase payment', count: overdue.length, to: paths.finance(), severity: 'late' },
    { label: expired.length === 1 ? 'sent quote has expired' : 'sent quotes have expired', detail: 'Follow up or mark declined', count: expired.length, to: paths.quotes(), severity: 'late' },
    { label: waitingApproval.length === 1 ? 'quote waiting for approval' : 'quotes waiting for approval', detail: 'Approve before sending', count: waitingApproval.length, to: paths.quotes() },
    { label: expiringSoon.length === 1 ? 'quote expires this week' : 'quotes expire this week', detail: 'Get an answer', count: expiringSoon.length, to: paths.quotes() },
    { label: noAnswer.length === 1 ? 'quote sent a week ago, no answer' : 'quotes sent a week ago, no answer', detail: 'Phone the client', count: noAnswer.length, to: paths.quotes() },
    { label: draftInvoices.length === 1 ? 'draft invoice not sent' : 'draft invoices not sent', detail: 'Check and send', count: draftInvoices.length, to: paths.finance() },
    { label: needsLinking === 1 ? 'bank line to link' : 'bank lines to link', detail: 'Reconcile the bank', count: needsLinking, to: paths.bank() },
    { label: unread.count === 1 ? 'unread email' : 'unread emails', detail: 'Read your mail', count: unread.count, to: paths.mail() },
  ]

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = (currentUser?.name ?? '').split(' ')[0]
  const todayCount = sitesToday.length + dayItems(today).length

  const profitData = active.map((p) => {
    const f = data.fin.get(p.id)
    return { name: p.code || p.name.slice(0, 14), profit: f?.gross_profit ?? 0, full: p.name }
  })

  return (
    <div className="space-y-4">
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden rounded-2xl bg-ink-950 px-6 py-6 text-white sm:px-7 sm:py-7">
        <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] font-bold tracking-[0.1em] text-brand-300 uppercase">{format(now, 'EEEE d MMMM')}</p>
            <h2 className="text-2xl font-extrabold tracking-tight">{greeting}{firstName ? `, ${firstName}` : ''}</h2>
            <p className="mt-0.5 text-[13px] text-white/60">
              {todayCount === 0 ? 'Nothing booked for today.' : `${sitesToday.length} job${sitesToday.length === 1 ? '' : 's'} on site today`}
              {` · ${live.length} open quote${live.length === 1 ? '' : 's'}`}
              {next ? ` · next job starts ${formatDate(next.start_date)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={paths.capture()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600">
              <Camera size={16} /> Snap slip
            </Link>
            <Link to={`${paths.quotes()}?new=1`} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/20">
              <FileText size={16} /> New quote
            </Link>
          </div>
        </div>
      </section>
      <ErrorBanner error={error} />

      <NeedsAttention items={attention} />

      {/* ---------- Money ---------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="In the bank"
          value={data.bank && data.bank.known > 0 ? formatZAR(data.bank.total, { decimals: 0 }) : '—'}
          hint={
            data.bank && data.bank.known > 0
              ? `On ${formatDate(data.bank.asAt)} statement${data.bank.unknown ? ` · ${data.bank.unknown} account${data.bank.unknown === 1 ? '' : 's'} without a balance` : ''}`
              : 'Import a statement that has a Balance column'
          }
          icon={<Wallet size={16} />}
        />
        <StatTile label="Owed to us" value={formatZAR(outstandingTotal, { decimals: 0 })} hint={`${outstanding.length} unpaid invoice${outstanding.length === 1 ? '' : 's'}${overdue.length ? `, ${overdue.length} overdue` : ''}`} tone={overdue.length ? 'bad' : 'default'} icon={<AlertCircle size={16} />} />
        <StatTile label="Open quotes" value={formatZAR(openValue, { decimals: 0 })} hint={`${live.length} open (draft or sent), excl. VAT`} icon={<FileText size={16} />} />
        <StatTile
          label="This month"
          value={formatZAR(income - spend, { decimals: 0 })}
          tone={income - spend >= 0 ? 'good' : 'bad'}
          hint={<span>In {formatZAR(income, { decimals: 0 })} · Spent {formatZAR(spend, { decimals: 0 })}</span>}
          icon={<Receipt size={16} />}
        />
      </div>

      {/* ---------- Today, tomorrow, next job ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <DayCard title="Today" date={now} sites={sitesToday} items={dayItems(today)} empty="Nothing booked for today." />
        <DayCard title="Tomorrow" date={addDays(now, 1)} sites={sitesTomorrow} items={dayItems(tomorrow)} empty="Nothing booked for tomorrow." />
        <Card title="Next job to start" actions={<Link to={paths.projects()} className="text-xs text-slate-500 hover:text-slate-800">Projects →</Link>}>
          {next ? (
            <Link to={paths.project(next.id)} className="block rounded-xl border border-slate-100 p-3 hover:border-slate-200 hover:bg-slate-50/60">
              <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
                {formatDate(next.start_date, 'EEE d MMM')} · in {differenceInCalendarDays(new Date(`${next.start_date}T00:00:00`), startOfDay(now))} day{differenceInCalendarDays(new Date(`${next.start_date}T00:00:00`), startOfDay(now)) === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{next.name}</p>
              {next.site_address && <p className="text-xs text-slate-500">{next.site_address}</p>}
              <p className="tabular mt-1 text-xs text-slate-500">{formatZAR(next.contract_value, { decimals: 0 })} contract{next.end_date ? ` · until ${formatDate(next.end_date)}` : ''}</p>
            </Link>
          ) : (
            <p className="text-sm text-slate-500">No project has a start date coming up.</p>
          )}
          {upcoming.length > 1 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {upcoming.slice(1, 4).map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <Link to={paths.project(p.id)} className="truncate text-slate-700 hover:text-brand-700">{p.name}</Link>
                  <span className="shrink-0 text-xs text-slate-500">{formatDate(p.start_date, 'd MMM')}</span>
                </li>
              ))}
            </ul>
          )}
          {plannedNoDate.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              {plannedNoDate.length} planned project{plannedNoDate.length === 1 ? ' has' : 's have'} no start date yet.
            </p>
          )}
        </Card>
      </div>

      {later.length > 0 && (
        <Card title="Later in the next two weeks" actions={<Link to={paths.diary()} className="text-xs text-slate-500 hover:text-slate-800">Diary →</Link>} padded={false}>
          <ul className="divide-y divide-slate-100">
            {later.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 px-5 py-2.5">
                <span className="w-24 shrink-0 text-xs font-medium text-slate-500">{formatDate(e.start_at, 'EEE d MMM')}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-800">{e.title}</span>
                  <span className="block text-xs text-slate-500">
                    {e.all_day ? 'All day' : format(new Date(e.start_at), 'HH:mm')} · {labelize(e.type)}
                    {e.project_id && projectName.get(e.project_id) ? ` · ${projectName.get(e.project_id)}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------- How the jobs are doing ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profit per active project" className="lg:col-span-2">
          {profitData.length === 0 ? (
            <EmptyState title="No active projects">Projects marked active show their gross profit here.</EmptyState>
          ) : (
            <div className="h-64">
              <LazyProfitPerProjectChart data={profitData} />
            </div>
          )}
        </Card>
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
                        <span className="block text-xs text-slate-500">{p.end_date ? `Until ${formatDate(p.end_date, 'd MMM')}` : p.code ?? ''}</span>
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
      </div>

      <Card title="Recent spending" padded={false} actions={<Link to={paths.expenses()} className="text-xs text-slate-500 hover:text-slate-800">All →</Link>}>
        {data.recent.length === 0 ? (
          <EmptyState title="No expenses yet">Snap a slip to record your first one.</EmptyState>
        ) : (
          <ul className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0">
            {data.recent.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 border-slate-100 px-4 py-2.5 md:border-b">
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
  )
}

/** One day: the jobs on site, then what is booked or due, in time order. */
function DayCard({ title, date, sites, items, empty }: { title: string; date: Date; sites: Project[]; items: DayItem[]; empty: string }) {
  return (
    <Card title={title} subtitle={format(date, 'EEEE d MMMM')} padded={false}>
      {sites.length === 0 && items.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sites.map((p) => (
            <li key={`site:${p.id}`}>
              <Link to={paths.project(p.id)} className="flex items-start gap-3 px-5 py-2.5 hover:bg-slate-50">
                <HardHat size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">On site: {p.name}</span>
                  {p.site_address && <span className="block truncate text-xs text-slate-500">{p.site_address}</span>}
                </span>
              </Link>
            </li>
          ))}
          {items.map((i) => (
            <li key={i.key}>
              <Link to={i.to} className="flex items-start gap-3 px-5 py-2.5 hover:bg-slate-50">
                <span className="w-16 shrink-0 pt-0.5 text-xs font-semibold text-brand-700">{i.when}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-800">{i.title}</span>
                  {i.sub && <span className="block truncate text-xs text-slate-500">{i.sub}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

interface AttentionItem {
  label: string
  /** What to do about it, in plain words. */
  detail: string
  count: number
  to: string
  /** 'late' is already past a date; otherwise it is merely waiting on someone. */
  severity?: 'late'
}

/**
 * Raptor's "Needs attention": everything waiting on us, worst first, each a link to the list.
 * Late items (past a date) lead whatever their size; clear ones are left out, and when nothing
 * is waiting it says so.
 */
function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const problems = items.filter((i) => i.count > 0).sort((a, b) => (a.severity === 'late' ? 0 : 1) - (b.severity === 'late' ? 0 : 1) || b.count - a.count)
  return (
    <Card title="Needs attention" subtitle="What is waiting on you">
      {problems.length === 0 ? (
        <div className="flex items-center gap-2.5 text-sm text-slate-500">
          <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
          All clear. Nothing is late or waiting on you.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {problems.map((item) => (
            <AttentionTile key={item.label} item={item} />
          ))}
        </div>
      )}
    </Card>
  )
}

function AttentionTile({ item }: { item: AttentionItem }): ReactNode {
  const late = item.severity === 'late'
  return (
    <Link to={item.to} title={item.detail} className="group flex items-center gap-3 rounded-xl border border-slate-100 px-3.5 py-3 hover:border-slate-200 hover:bg-slate-50/60">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${late ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
        {late ? <AlertCircle size={17} /> : <AlertTriangle size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg leading-none font-extrabold text-slate-800 tabular-nums">{item.count}</span>
        <span className="mt-1 block text-[11.5px] leading-snug text-slate-500">{item.label}</span>
      </span>
      <span className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold whitespace-nowrap ${late ? 'text-red-700' : 'text-amber-700'}`}>
        {item.detail} <ChevronRight size={12} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
