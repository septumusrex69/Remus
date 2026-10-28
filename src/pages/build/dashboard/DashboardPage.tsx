import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { addDays, addMonths, differenceInCalendarDays, endOfMonth, format, startOfDay, startOfMonth } from 'date-fns'
import {
  AlertCircle, AlertTriangle, Camera, CheckCircle2, ChevronRight, FileText, HardHat, Receipt, Wallet,
  Bot, ClipboardCheck,
} from 'lucide-react'
import {
  invoices as invoicesApi,
  listEventsBetween,
  listExpensesBetween,
  listCrewDays,
  listPaymentsBetween,
  listProjectFinancials,
  listQuoteTotals,
  listRecentExpenses,
  loadBankBalances,
  projectStages,
  stageBookings,
  workers as workersApi,
  payments as paymentsApi,
  projects as projectsApi,
  quotes as quotesApi,
  getSettings,
  loadClaudeCredit,
  usdAndZar,
  USD_TO_ZAR,
} from '../../../lib/api'
import { formatDate, formatPct, formatZAR, labelize, ymd } from '../../../lib/format'
import { outstandingInvoices } from '../../../lib/finance'
import { approvalCurrent } from '../../../lib/quoteMath'
import { useLoad } from '../../../hooks/useLoad'
import { useAuth } from '../../../store/AuthContext'
import { editsQuotes, seesBudget, seesMoney, seesQuotes, useAccess } from '../../../lib/access'
import { Card, EmptyState, ErrorBanner, Spinner } from '../../../components/ui'
import type { DiaryEvent, Project } from '../../../types'
import { crewSources, scoreProject } from '../../../lib/projectScores'
import { BudgetBar } from '../components/BudgetBar'
import { lastMonths, monthlyProfit, overheadRecovery } from '../../../lib/companyProfit'
import { CompanyProfit } from './CompanyProfit'
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
  // Six months of slips for "What the company made" (this month's are a subset of them).
  const sixFrom = ymd(startOfMonth(addMonths(now, -5)))
  const [projects, fin, quotes, totals, invoices, allPayments, monthPayments, sixMonthExpenses, events, recent, bank, claude, stages, bookings, workers] = await Promise.all([
    projectsApi.list(),
    listProjectFinancials(),
    quotesApi.list(),
    listQuoteTotals(),
    invoicesApi.list(),
    paymentsApi.list(),
    listPaymentsBetween(from, to),
    listExpensesBetween(sixFrom, to),
    // From the start of today, so today's earlier and all-day events still show.
    listEventsBetween(startOfDay(now).toISOString(), addDays(startOfDay(now), 15).toISOString()),
    listRecentExpenses(6),
    loadBankBalances().catch(() => null),
    // Claude credit (Remus · Handoff 1): Remus's own count against what was bought; never blocks the page.
    getSettings().then((st) => loadClaudeCredit(st.ai_credit_usd)).catch(() => null),
    projectStages.list().catch(() => []),
    stageBookings.list().catch(() => []),
    workersApi.list().catch(() => []),
  ])
  // The crew register from the earliest of six months ago and the start of any job still open.
  const open = projects.filter((p) => p.status === 'active' || p.status === 'on_hold').map((p) => p.start_date).filter((d): d is string => !!d)
  const registerFrom = [sixFrom, ...open].sort()[0]
  const register = await listCrewDays(registerFrom, to).catch(() => [])
  const monthExpenses = sixMonthExpenses.filter((e) => e.date >= from)
  return { projects, fin, quotes, totals, invoices, allPayments, monthPayments, monthExpenses, sixMonthExpenses, events, recent, bank, claude, stages, bookings, workers, register }
}

/** Is the project on site that day: active, and the day inside its dates (or it has none). */
function onSite(p: Project, day: string): boolean {
  if (p.status !== 'active') return false
  return (!p.start_date || p.start_date <= day) && (!p.end_date || p.end_date >= day)
}

/** The colour of an item's time tag, by what it is. */
type Tone = 'site' | 'visit' | 'delivery' | 'meeting' | 'money' | 'deadline' | 'plain'

const TONE: Record<Tone, string> = {
  site: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  visit: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  delivery: 'bg-sky-50 text-sky-700 ring-sky-200',
  meeting: 'bg-brand-50 text-brand-700 ring-brand-200',
  money: 'bg-red-50 text-red-700 ring-red-200',
  deadline: 'bg-amber-50 text-amber-800 ring-amber-200',
  plain: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const EVENT_TONE: Record<string, Tone> = { site_visit: 'visit', inspection: 'visit', delivery: 'delivery', meeting: 'meeting', quote_appointment: 'meeting' }

interface DayItem {
  key: string
  tone: Tone
  when: string
  title: string
  sub?: string
  to: string
}

export function DashboardPage() {
  const { data, error, loading } = useLoad(load, [], 'dashboard')
  const { needsLinking } = useBuild()
  const { currentUser } = useAuth()
  // Who sees what (lib/access.ts): the money for Administrators, the budget for contractors too.
  const access = useAccess()
  const money = seesMoney(access)
  const budget = seesBudget(access)
  const quotesToo = seesQuotes(access)

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
        tone: EVENT_TONE[e.type] ?? 'plain',
        when: e.all_day ? 'All day' : format(new Date(e.start_at), 'HH:mm'),
        title: e.title,
        sub: [labelize(e.type), e.project_id ? projectName.get(e.project_id) : null, e.location].filter(Boolean).join(' · '),
        to: paths.diary(),
      })
    }
    for (const p of data!.projects.filter((x) => x.start_date === day && (x.status === 'planned' || x.status === 'active'))) {
      items.push({ key: `s:${p.id}`, tone: 'site', when: 'Starts', title: p.name, sub: p.site_address ?? undefined, to: paths.project(p.id) })
    }
    for (const p of data!.projects.filter((x) => x.end_date === day && x.status === 'active')) {
      items.push({ key: `f:${p.id}`, tone: 'plain', when: 'Finishes', title: p.name, sub: p.site_address ?? undefined, to: paths.project(p.id) })
    }
    for (const q of data!.quotes.filter((x) => quotesToo && (x.status === 'sent' || x.status === 'draft') && x.valid_until === day)) {
      items.push({ key: `q:${q.id}`, tone: 'deadline', when: 'Quote ends', title: `${q.number ?? ''} ${q.title}`.trim(), to: paths.quote(q.id) })
    }
    for (const o of outstanding.filter((x) => money && x.invoice.due_date === day)) {
      items.push({ key: `i:${o.invoice.id}`, tone: 'money', when: 'Payment due', title: `${o.invoice.number ?? 'Invoice'} · ${formatZAR(o.outstanding, { decimals: 0 })}`, to: paths.finance() })
    }
    return items
  }
  // Who is booked on a project's stages that day (Plan & crew); a booked job counts as on site.
  const stageProject = new Map(data.stages.map((s) => [s.id, s.project_id]))
  const workerName = new Map(data.workers.map((w) => [w.id, w.name]))
  const crewOn = (projectId: string, day: string) =>
    data.bookings.filter((b) => stageProject.get(b.stage_id) === projectId && b.start_date <= day && b.end_date >= day).map((b) => workerName.get(b.worker_id) ?? 'Worker')
  const bookedOn = (day: string) => new Set(data.bookings.filter((b) => b.start_date <= day && b.end_date >= day).map((b) => stageProject.get(b.stage_id)))
  const sitesToday = data.projects.filter((p) => onSite(p, today) || bookedOn(today).has(p.id))
  const sitesTomorrow = data.projects.filter((p) => onSite(p, tomorrow) || bookedOn(tomorrow).has(p.id))
  const later = data.events.filter((e) => ymd(new Date(e.start_at)) > tomorrow).slice(0, 5)

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = (currentUser?.name ?? '').split(' ')[0]
  const todayCount = sitesToday.length + dayItems(today).length

  /*
   * EACH JOB'S PROFIT AND VERDICT, the same sums as the project's own scorecard (lib/jobScore.ts):
   * slips by category plus the crew's booked days, against the quoted cost the plan was made from
   * (its stages carry the quote's cost by kind), or the budget where there is no plan.
   */
  const crewSrc = crewSources(data.stages, data.bookings, data.workers, data.register)
  const jobOf = (p: Project) => scoreProject(p, { fin: data.fin, stages: data.stages, crew: crewSrc }, today)
  const jobs = new Map(active.map((p) => [p.id, jobOf(p)]))
  // Where each running job is heading, not contract-less-costs-so-far (that flatters a job half done).
  const expected = (id: string) => { const j = jobs.get(id)!; return j.profitForecast ?? j.profitNow }
  const profitData = active.map((p) => ({ name: p.code || p.name.slice(0, 14), profit: expected(p.id), full: p.name }))

  // ---------- Needs attention ----------
  /*
   * THE BUDGET WARNING (Stephan, 28 Oct: "it should start giving a warning when you start ... spending too
   * much, or you're nearing your budget"): every running job over, nearing or racing through its quoted
   * cost (scoreJob). Shown to whoever sees budgets; the money lines to Administrators only.
   */
  const overBudget = active.filter((p) => jobs.get(p.id)!.tone === 'bad')
  const nearBudget = active.filter((p) => jobs.get(p.id)!.tone === 'warn')
  const onlyOne = (ps: Project[]) => (ps.length === 1 ? paths.project(ps[0].id) : paths.projects())
  const attention: AttentionItem[] = budget ? [
    { label: overBudget.length === 1 ? `job over budget: ${overBudget[0].name}` : 'jobs over budget', detail: 'See where it went', count: overBudget.length, to: onlyOne(overBudget), severity: 'late' },
    { label: nearBudget.length === 1 ? `job nearing its budget: ${nearBudget[0].name}` : 'jobs nearing their budget', detail: 'Check before it runs over', count: nearBudget.length, to: onlyOne(nearBudget) },
  ] : []
  if (money) attention.push(
    { label: overdue.length === 1 ? 'invoice overdue' : 'invoices overdue', detail: 'Chase payment', count: overdue.length, to: paths.finance(), severity: 'late' },
    { label: expired.length === 1 ? 'sent quote has expired' : 'sent quotes have expired', detail: 'Follow up or mark declined', count: expired.length, to: paths.quotes(), severity: 'late' },
    { label: waitingApproval.length === 1 ? 'quote waiting for approval' : 'quotes waiting for approval', detail: 'Approve before sending', count: waitingApproval.length, to: paths.quotes() },
    { label: expiringSoon.length === 1 ? 'quote expires this week' : 'quotes expire this week', detail: 'Get an answer', count: expiringSoon.length, to: paths.quotes() },
    { label: noAnswer.length === 1 ? 'quote sent a week ago, no answer' : 'quotes sent a week ago, no answer', detail: 'Phone the client', count: noAnswer.length, to: paths.quotes() },
    { label: draftInvoices.length === 1 ? 'draft invoice not sent' : 'draft invoices not sent', detail: 'Check and send', count: draftInvoices.length, to: paths.finance() },
    { label: needsLinking === 1 ? 'bank line to link' : 'bank lines to link', detail: 'Reconcile the bank', count: needsLinking, to: paths.bank() },
  )

  // ---------- What the company made ----------
  const months = lastMonths(today, 6)
  const ladder = monthlyProfit({ months, invoices: data.invoices, expenses: data.sixMonthExpenses, crew: crewSrc, today })
  // The overhead share is read from the finished months only: a part month has its rent and not its work.
  const recovery = overheadRecovery(ladder.slice(0, -1))

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
              {quotesToo ? ` · ${live.length} open quote${live.length === 1 ? '' : 's'}` : ''}
              {next ? ` · next job starts ${formatDate(next.start_date)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={paths.capture()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600">
              <Camera size={16} /> Snap slip
            </Link>
            {editsQuotes(access) && (
              <Link to={`${paths.quotes()}?new=1`} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/20">
                <FileText size={16} /> New quote
              </Link>
            )}
          </div>
        </div>
      </section>
      <ErrorBanner error={error} />

      <NeedsAttention items={attention} />

      {/* ---------- Today, tomorrow, next job ---------- */}
      <SectionLabel>What is happening</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-3">
        <DayCard register title="Today" date={now} sites={sitesToday} crew={(p) => crewOn(p.id, today)} items={dayItems(today)} empty="Nothing booked for today." accent="bg-brand-600" />
        <DayCard title="Tomorrow" date={addDays(now, 1)} sites={sitesTomorrow} crew={(p) => crewOn(p.id, tomorrow)} items={dayItems(tomorrow)} empty="Nothing booked for tomorrow." accent="bg-ink-900" />
        <section className="card overflow-hidden">
          <header className="flex items-center justify-between bg-emerald-700 px-5 py-3 text-white">
            <span>
              <span className="block text-[15px] font-semibold">Next job to start</span>
              <span className="block text-xs text-white/70">{upcoming.length ? `${upcoming.length} coming up` : 'Nothing dated yet'}</span>
            </span>
            <Link to={paths.projects()} className="text-xs text-white/80 hover:text-white">Projects →</Link>
          </header>
          <div className="p-4">
            {next ? (
              <Link to={paths.project(next.id)} className="block rounded-xl bg-emerald-50 p-3.5 ring-1 ring-emerald-100 hover:ring-emerald-300">
                <p className="text-xs font-bold tracking-wide text-emerald-800 uppercase">
                  {formatDate(next.start_date, 'EEE d MMM')} · in {daysUntil(next.start_date!, now)} day{daysUntil(next.start_date!, now) === 1 ? '' : 's'}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{next.name}</p>
                {next.site_address && <p className="text-xs text-slate-600">{next.site_address}</p>}
                <p className="tabular mt-1.5 text-xs text-slate-600">{[money ? `${formatZAR(next.contract_value, { decimals: 0 })} contract` : null, next.end_date ? `until ${formatDate(next.end_date, 'd MMM')}` : null].filter(Boolean).join(' · ')}</p>
              </Link>
            ) : (
              <p className="text-sm text-slate-500">No project has a start date coming up.</p>
            )}
            {upcoming.length > 1 && (
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {upcoming.slice(1, 4).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 py-1.5">
                    <Link to={paths.project(p.id)} className="truncate text-slate-700 hover:text-brand-700">{p.name}</Link>
                    <span className="shrink-0 text-xs font-medium text-slate-500">{formatDate(p.start_date, 'd MMM')}</span>
                  </li>
                ))}
              </ul>
            )}
            {plannedNoDate.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                {plannedNoDate.length} planned project{plannedNoDate.length === 1 ? ' has' : 's have'} no start date yet.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* ---------- Money (Administrators: lib/access.ts) ---------- */}
      {money && <>
      <SectionLabel>Money</SectionLabel>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MoneyTile
          label="In the bank"
          icon={<Wallet size={18} />}
          chip="bg-emerald-100 text-emerald-700"
          value={data.bank && data.bank.known > 0 ? formatZAR(data.bank.total, { decimals: 0 }) : '—'}
          hint={
            data.bank && data.bank.known > 0
              ? `On the ${formatDate(data.bank.asAt, 'd MMM')} statement${data.bank.unknown ? ` · ${data.bank.unknown} account${data.bank.unknown === 1 ? '' : 's'} without a balance` : ''}`
              : 'Import a statement with a Balance column'
          }
          to={paths.bank()}
        />
        <MoneyTile
          label="Owed to us"
          icon={<AlertCircle size={18} />}
          chip={overdue.length ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}
          value={formatZAR(outstandingTotal, { decimals: 0 })}
          valueClass={overdue.length ? 'text-red-700' : undefined}
          hint={`${outstanding.length} unpaid invoice${outstanding.length === 1 ? '' : 's'}${overdue.length ? `, ${overdue.length} overdue` : ''}`}
          to={paths.finance()}
        />
        <MoneyTile
          label="Open quotes"
          icon={<FileText size={18} />}
          chip="bg-brand-100 text-brand-700"
          value={formatZAR(openValue, { decimals: 0 })}
          hint={`${live.length} open (draft or sent), excl. VAT`}
          to={paths.quotes()}
        />
        <MoneyTile
          label="This month"
          icon={<Receipt size={18} />}
          chip={income - spend >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}
          value={formatZAR(income - spend, { decimals: 0 })}
          valueClass={income - spend >= 0 ? 'text-emerald-700' : 'text-red-700'}
          hint={`In ${formatZAR(income, { decimals: 0 })} · Spent ${formatZAR(spend, { decimals: 0 })}`}
          to={paths.finance()}
        />
        {/* Stephan: "how many credits do we have, we use and how many credits do we have left". */}
        <MoneyTile
          label="Claude credit"
          icon={<Bot size={18} />}
          chip={data.claude && data.claude.boughtUsd > 0 && data.claude.leftUsd < data.claude.boughtUsd * 0.2 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}
          value={data.claude && data.claude.boughtUsd > 0 ? `$${data.claude.leftUsd.toFixed(2)} left` : '—'}
          // The rand under the dollars: Anthropic bills in dollars, Urban Haus thinks in rand.
          hint={data.claude
            ? `≈ ${formatZAR(data.claude.leftUsd * USD_TO_ZAR, { decimals: 0 })} left · used ${usdAndZar(data.claude.usedUsd)} · this month ${usdAndZar(data.claude.monthUsd)}`
            : 'Set what you bought in Settings'}
          to={paths.settings('Integrations')}
        />
      </div>
      </>}

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
      {budget && <>
      <SectionLabel>How the jobs are doing</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-3">
        {money && <Card title="Profit per active project" subtitle="Where each job is heading, if the rest costs what was quoted." className="lg:col-span-2">
          {profitData.length === 0 ? (
            <EmptyState title="No active projects">Projects marked active show their gross profit here.</EmptyState>
          ) : (
            <div className="h-64">
              <LazyProfitPerProjectChart data={profitData} />
            </div>
          )}
        </Card>}
        <Card title="Active projects" padded={false} actions={<Link to={paths.projects()} className="text-xs text-slate-500 hover:text-slate-800">All →</Link>}>
          {active.length === 0 ? (
            <EmptyState title="No active projects" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {active.map((p) => {
                const j = jobs.get(p.id)!
                const revised = Number(p.contract_value) + (data.fin.get(p.id)?.approved_variations ?? 0)
                return (
                  <li key={p.id}>
                    <Link to={paths.project(p.id)} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{p.name}</span>
                        <span className="block text-xs text-slate-500">{p.end_date ? `Until ${formatDate(p.end_date, 'd MMM')}` : p.code ?? ''}</span>
                        <BudgetBar score={j} compact />
                        <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${JOB_TONE[j.tone]}`} title={j.detail ?? undefined}>
                          {money ? (j.tone === 'good' ? 'On track' : j.tone === 'neutral' ? 'No quote to compare' : j.tone === 'bad' ? 'Over the quoted cost' : 'Watch the spending') : j.plain}
                        </span>
                      </span>
                      {money && (
                        <span className="tabular shrink-0 text-right text-sm">
                          <span className={expected(p.id) < 0 ? 'text-red-600' : 'text-slate-800'}>{formatZAR(expected(p.id), { decimals: 0 })}</span>
                          <span className="block text-xs text-slate-500">{formatPct(revised ? (expected(p.id) / revised) * 100 : null)} expected</span>
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      </>}

      {/* ---------- What the company made (Remus · Handoff 1, 28 Oct) ---------- */}
      {money && <>
      <SectionLabel>What the company made</SectionLabel>
      <CompanyProfit ladder={ladder} recovery={recovery} />

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
      </>}
    </div>
  )
}

/** Whole days from today to a date. */
function daysUntil(day: string, now: Date): number {
  return differenceInCalendarDays(new Date(`${day}T00:00:00`), startOfDay(now))
}

const JOB_TONE = {
  good: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-800',
  bad: 'bg-red-50 text-red-700',
  neutral: 'bg-slate-100 text-slate-500',
} as const

/** A quiet heading between the dashboard's groups, so each block reads as its own part. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <h3 className="text-xs font-bold tracking-[0.08em] text-slate-500 uppercase">{children}</h3>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  )
}

function MoneyTile({ label, icon, chip, value, valueClass, hint, to }: { label: string; icon: ReactNode; chip: string; value: string; valueClass?: string; hint: string; to: string }) {
  return (
    <Link to={to} className="card group block p-4 transition hover:shadow-md sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${chip}`}>{icon}</span>
        <span className="text-sm font-medium text-slate-600">{label}</span>
      </div>
      <p className={`tabular mt-3 text-xl font-bold sm:text-2xl ${valueClass ?? 'text-slate-900'}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </Link>
  )
}

/** One day: the jobs on site, then what is booked or due, each with a coloured tag. */
function DayCard({ title, date, sites, crew, items, empty, accent, register }: { title: string; date: Date; sites: Project[]; crew: (p: Project) => string[]; items: DayItem[]; empty: string; accent: string; register?: boolean }) {
  const count = sites.length + items.length
  return (
    <section className="card overflow-hidden">
      <header className={`flex items-center justify-between px-5 py-3 text-white ${accent}`}>
        <span>
          <span className="block text-[15px] font-semibold">{title}</span>
          <span className="block text-xs text-white/70">{format(date, 'EEEE d MMMM')}</span>
        </span>
        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold">{count}</span>
      </header>
      {count === 0 ? (
        <p className="px-5 py-5 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sites.map((p) => (
            <li key={`site:${p.id}`}>
              <Link to={paths.project(p.id)} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50">
                <span className={`mt-0.5 inline-flex w-[5.5rem] shrink-0 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${TONE.site}`}>
                  <HardHat size={12} /> On site
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">{p.name}</span>
                  {p.site_address && <span className="block truncate text-xs text-slate-500">{p.site_address}</span>}
                  {crew(p).length > 0 && <span className="block truncate text-xs font-medium text-emerald-700">{crew(p).join(', ')}</span>}
                </span>
              </Link>
            </li>
          ))}
          {items.map((i) => (
            <li key={i.key}>
              <Link to={i.to} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50">
                <span className={`mt-0.5 inline-flex w-[5.5rem] shrink-0 justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${TONE[i.tone]}`}>{i.when}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-800">{i.title}</span>
                  {i.sub && <span className="block truncate text-xs text-slate-500">{i.sub}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {/* Today's crew is ticked off on the register (Remus · Handoff 1): who actually came. */}
      {register && sites.length > 0 && (
        <Link to={paths.crew()} className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-slate-50">
          <ClipboardCheck size={15} /> Register today's crew
        </Link>
      )}
    </section>
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
 * Late items (past a date) are red and lead; waiting ones are amber; clear ones are left out.
 */
function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const problems = items.filter((i) => i.count > 0).sort((a, b) => (a.severity === 'late' ? 0 : 1) - (b.severity === 'late' ? 0 : 1) || b.count - a.count)
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-slate-800">Needs attention</h2>
        {problems.length > 0 && <span className="text-xs text-slate-500">{problems.length} thing{problems.length === 1 ? '' : 's'} waiting on you</span>}
      </div>
      {problems.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={20} className="shrink-0" />
          All clear. Nothing is late or waiting on you.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] sm:gap-3">
          {problems.map((item) => (
            <AttentionTile key={item.label} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}

function AttentionTile({ item }: { item: AttentionItem }) {
  const late = item.severity === 'late'
  return (
    <Link
      to={item.to}
      className={`group flex flex-col rounded-xl border-l-4 p-3 transition sm:p-3.5 hover:shadow-sm ${late ? 'border-red-500 bg-red-50 hover:bg-red-100/70' : 'border-amber-400 bg-amber-50 hover:bg-amber-100/70'}`}
    >
      <span className="flex items-center gap-2">
        <span className={late ? 'text-red-600' : 'text-amber-600'}>{late ? <AlertCircle size={18} /> : <AlertTriangle size={17} />}</span>
        <span className="text-2xl leading-none font-extrabold text-slate-900 tabular-nums">{item.count}</span>
      </span>
      <span className="mt-1.5 text-[13px] leading-snug text-slate-700 sm:text-sm">{item.label}</span>
      <span className={`mt-2 inline-flex items-center gap-0.5 text-xs font-semibold ${late ? 'text-red-700' : 'text-amber-800'}`}>
        {item.detail} <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
