import { useMemo, useState } from 'react'
import { seesMoney, useAccess } from '../../../lib/access'
import { Link, useSearchParams } from 'react-router-dom'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { Check, ChevronLeft, ChevronRight, ClipboardCheck, Copy, Printer, UserPlus, X } from 'lucide-react'
import { crewDays as crewDaysApi, listCrewDays, projectStages, projects as projectsApi, setCrewDay, stageBookings, workers as workersApi } from '../../../lib/api'
import { formatZAR, todayYmd, ymd } from '../../../lib/format'
import { wageList, workedDays, type CrewSources } from '../../../lib/crewDays'
import { isWorkingDay } from '../../../lib/workdays'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Tabs } from '../../../components/ui'
import type { CrewDay, Project, Worker } from '../../../types'
import { paths } from '../paths'

/**
 * THE CREW REGISTER (Remus · Handoff 1, 28 Oct 2026). Stephan: "a certain person is at a certain site ...
 * on a certain day. We need to keep track of that." Two tabs:
 *
 *   Day   -- each site with the people booked on it that day; tick who came (there, half a day, not
 *            there), and add anybody who came unbooked. One tap per person, made for a phone on site.
 *   Wages -- the week's list: days per person, confirmed and still only booked, and the money, to pay
 *            the crew from. Days nobody has confirmed are counted (as booked) and shown apart.
 *
 * What is ticked here is what every labour figure uses (lib/crewDays.ts): the project's scorecard,
 * Plan & crew, and the company's month. A booking is the plan; this is what happened.
 */
type Tab = 'day' | 'wages'

async function load(from: string, to: string) {
  const [workers, projects, stages, bookings, register] = await Promise.all([
    workersApi.list(),
    projectsApi.list(),
    projectStages.list(),
    stageBookings.list(),
    listCrewDays(from, to),
  ])
  return { workers, projects, stages, bookings, register }
}

const STATES: { days: number; label: string; tone: string }[] = [
  { days: 1, label: 'There', tone: 'bg-emerald-600 text-white border-emerald-600' },
  { days: 0.5, label: 'Half day', tone: 'bg-amber-500 text-white border-amber-500' },
  { days: 0, label: 'Not there', tone: 'bg-slate-600 text-white border-slate-600' },
]

export function CrewRegisterPage() {
  const [params, setParams] = useSearchParams()
  // The wage list is money: Administrators only (lib/access.ts). Everybody fills in the day.
  const money = seesMoney(useAccess())
  const tab: Tab = money && params.get('tab') === 'wages' ? 'wages' : 'day'
  const day = params.get('day') ?? todayYmd()
  const weekStart = ymd(startOfWeek(parseISO(day), { weekStartsOn: 1 }))
  const weekEnd = ymd(addDays(parseISO(weekStart), 6))
  const { data, error, loading, reload } = useLoad(() => load(weekStart, weekEnd), [weekStart], `crew:${weekStart}`)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const set = (p: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(p)) next.set(k, v)
    setParams(next, { replace: true })
  }

  const ctx = useMemo(() => {
    if (!data) return null
    const workers = new Map(data.workers.map((w) => [w.id, w]))
    const projects = new Map(data.projects.map((p) => [p.id, p]))
    const src: CrewSources = { bookings: data.bookings, register: data.register, stageProject: new Map(data.stages.map((s) => [s.id, s.project_id])), workers }
    return { workers, projects, src }
  }, [data])

  if (loading && !data) return <Spinner page />
  if (!data || !ctx) return <ErrorBanner error={error} />

  async function mark(worker: Worker, project_id: string, stage_id: string | null, days: number, existing?: CrewDay) {
    const key = `${worker.id}|${project_id}`
    setBusy(key); setErr(null)
    try {
      // The rate already on the row stays: re-ticking last Tuesday must not reprice it at today's rate.
      await setCrewDay({ worker_id: worker.id, project_id, stage_id, day, days, day_cost: existing ? existing.day_cost : Number(worker.day_cost) })
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  async function clear(row: CrewDay) {
    setBusy(`${row.worker_id}|${row.project_id}`); setErr(null)
    try { await crewDaysApi.remove(row.id); reload() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  return (
    <div>
      <PageHeader
        title="Crew register"
        subtitle={money ? "Who was on which site each day, and the week's wages. Booked days count until someone confirms them." : 'Who was on which site each day. Tick off the crew on each site; people who are booked count until someone confirms them.'}
        actions={<Link to={paths.workers()} className="text-sm text-slate-500 hover:text-slate-800">Workers →</Link>}
      />
      <ErrorBanner error={err ?? error} />
      {money && <Tabs<Tab> value={tab} onChange={(t) => set({ tab: t })} tabs={[{ id: 'day', label: 'Day' }, { id: 'wages', label: 'Wages for the week' }]} />}
      {tab === 'day'
        ? <DayView day={day} data={data} ctx={ctx} busy={busy} money={money} onDay={(d) => set({ day: d })} onMark={mark} onClear={clear} />
        : <WagesView weekStart={weekStart} weekEnd={weekEnd} ctx={ctx} onWeek={(d) => set({ day: d })} />}
    </div>
  )
}

type Data = Awaited<ReturnType<typeof load>>
type Ctx = { workers: Map<string, Worker>; projects: Map<string, Project>; src: CrewSources }

function DayPicker({ day, onDay, step }: { day: string; onDay: (d: string) => void; step: number }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50" aria-label="Earlier" onClick={() => onDay(ymd(addDays(parseISO(day), -step)))}><ChevronLeft size={16} /></button>
      <input type="date" className="input w-auto" value={day} onChange={(e) => e.target.value && onDay(e.target.value)} aria-label="Day" />
      <button type="button" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50" aria-label="Later" onClick={() => onDay(ymd(addDays(parseISO(day), step)))}><ChevronRight size={16} /></button>
      {day !== todayYmd() && <Button size="sm" onClick={() => onDay(todayYmd())}>Today</Button>}
    </div>
  )
}

function DayView({ day, data, ctx, busy, money, onDay, onMark, onClear }: {
  /** Show each person's day rate (Administrators only). */
  money: boolean
  day: string
  data: Data
  ctx: Ctx
  busy: string | null
  onDay: (d: string) => void
  onMark: (w: Worker, project: string, stage: string | null, days: number, existing?: CrewDay) => void
  onClear: (row: CrewDay) => void
}) {
  const [adding, setAdding] = useState<{ worker: string; project: string } | null>(null)
  // Each site with its people that day: booked (from the plan) and registered (from the register).
  const sites = new Map<string, { worker: Worker; stage: string | null; row?: CrewDay }[]>()
  const put = (project: string, worker: Worker, stage: string | null, row?: CrewDay) => {
    const list = sites.get(project) ?? []
    const at = list.findIndex((x) => x.worker.id === worker.id)
    if (at >= 0) list[at] = { ...list[at], row: row ?? list[at].row }
    else list.push({ worker, stage, row })
    sites.set(project, list)
  }
  for (const b of data.bookings) {
    const project = ctx.src.stageProject.get(b.stage_id)
    const w = ctx.workers.get(b.worker_id)
    if (project && w && b.start_date <= day && b.end_date >= day) put(project, w, b.stage_id)
  }
  for (const r of data.register.filter((x) => x.day === day)) {
    const w = ctx.workers.get(r.worker_id)
    if (w) put(r.project_id, w, r.stage_id, r)
  }
  const elsewhere = (workerId: string, project: string) => data.register.find((r) => r.day === day && r.worker_id === workerId && r.project_id !== project && r.days > 0)
  const openProjects = data.projects.filter((p) => p.status === 'active' || p.status === 'planned' || p.status === 'on_hold')
  const workerList = data.workers.filter((w) => w.active)
  const unconfirmed = [...sites.values()].flat().filter((x) => !x.row && !elsewhere(x.worker.id, '')).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DayPicker day={day} onDay={onDay} step={1} />
        <p className="text-sm text-slate-600">
          <strong>{format(parseISO(day), 'EEEE d MMMM')}</strong>
          {!isWorkingDay(day) && <span className="ml-2 text-amber-700">(not a working day)</span>}
          {unconfirmed > 0 && <span className="ml-2 text-amber-700">· {unconfirmed} not confirmed yet</span>}
        </p>
      </div>

      {sites.size === 0 && <EmptyState title="Nobody booked on a site this day" icon={<ClipboardCheck size={20} />}>Book crew in a project's Plan &amp; crew, or add someone who came below.</EmptyState>}

      {[...sites.entries()].map(([projectId, people]) => {
        const p = ctx.projects.get(projectId)
        const open = people.filter((x) => !x.row)
        return (
          <Card key={projectId} title={<Link to={paths.project(projectId, 'plan')} className="hover:text-brand-700">{p?.name ?? 'Project'}</Link>} subtitle={p?.site_address ?? undefined}
            actions={open.length > 1 ? <Button size="sm" onClick={() => open.forEach((x) => onMark(x.worker, projectId, x.stage, 1))}><Check size={14} /> Everyone booked was there</Button> : undefined}>
            <ul className="divide-y divide-slate-100">
              {people.map(({ worker, stage, row }) => {
                const away = elsewhere(worker.id, projectId)
                const k = `${worker.id}|${projectId}`
                return (
                  <li key={worker.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                    <span className="min-w-[10rem] flex-1">
                      <span className="block text-sm font-medium text-slate-800">{worker.name}</span>
                      <span className="block text-xs text-slate-500">
                        {[worker.trade, worker.grade === 'senior' ? 'Senior' : 'Junior', money ? `${formatZAR(row ? row.day_cost : worker.day_cost, { decimals: 0 })} a day` : null].filter(Boolean).join(' · ')}
                        {!row && !away && <span className="ml-1 font-medium text-amber-700">· booked, not confirmed</span>}
                        {!row && away && <span className="ml-1 text-slate-500">· registered at {ctx.projects.get(away.project_id)?.name ?? 'another site'}</span>}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5" role="group" aria-label={`${worker.name} on ${p?.name ?? 'site'}`}>
                      {STATES.map((st) => {
                        const on = row && Number(row.days) === st.days
                        return (
                          <button key={st.label} type="button" disabled={busy === k} aria-pressed={!!on}
                            onClick={() => onMark(worker, projectId, stage, st.days, row)}
                            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${on ? st.tone : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                            {st.label}
                          </button>
                        )
                      })}
                      {row && (
                        <button type="button" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Clear: back to the booking" aria-label="Clear" onClick={() => onClear(row)}>
                          <X size={15} />
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}

      <Card title="Someone came who was not booked?">
        {adding ? (
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={adding.worker} onChange={(e) => setAdding({ ...adding, worker: e.target.value })} aria-label="Who">
              <option value="">Who…</option>
              {workerList.map((w) => <option key={w.id} value={w.id}>{w.name}{w.trade ? ` (${w.trade})` : ''}</option>)}
            </select>
            <span className="text-sm text-slate-500">at</span>
            <select className="input w-auto" value={adding.project} onChange={(e) => setAdding({ ...adding, project: e.target.value })} aria-label="Which site">
              <option value="">Which site…</option>
              {openProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button variant="primary" disabled={!adding.worker || !adding.project}
              onClick={() => { const w = ctx.workers.get(adding.worker); if (w) onMark(w, adding.project, null, 1); setAdding(null) }}>
              <Check size={14} /> There
            </Button>
            <Button onClick={() => setAdding(null)}>Cancel</Button>
          </div>
        ) : (
          <Button onClick={() => setAdding({ worker: '', project: '' })}><UserPlus size={14} /> Add a person to a site</Button>
        )}
        {workerList.length === 0 && <p className="mt-2 text-sm text-slate-500">No workers yet. <Link className="text-brand-700 underline" to={`${paths.workers()}?new=1`}>Add your crew</Link> first.</p>}
      </Card>
    </div>
  )
}

function WagesView({ weekStart, weekEnd, ctx, onWeek }: { weekStart: string; weekEnd: string; ctx: Ctx; onWeek: (d: string) => void }) {
  const today = todayYmd()
  // Up to today: next Thursday's booking is not a wage yet.
  const to = weekEnd < today ? weekEnd : today
  const lines = wageList(ctx.src, weekStart, to)
    .map((l) => ({ ...l, worker: ctx.workers.get(l.worker_id) }))
    .sort((a, b) => (a.worker?.name ?? '').localeCompare(b.worker?.name ?? ''))
  const total = lines.reduce((t, l) => t + l.amount, 0)
  const pending = lines.reduce((t, l) => t + l.unconfirmed, 0)
  const days = workedDays(ctx.src, weekStart, to)
  const site = (id: string) => ctx.projects.get(id)?.code || ctx.projects.get(id)?.name || 'Site'
  const dayCount = (n: number) => (n === 1 ? '1 day' : `${n} days`)

  const text = [
    `Wages ${format(parseISO(weekStart), 'd MMM')} – ${format(parseISO(weekEnd), 'd MMM yyyy')}`,
    ...lines.map((l) => `${l.worker?.name ?? 'Worker'}: ${dayCount(l.confirmed + l.unconfirmed)}, ${formatZAR(l.amount)}${l.unconfirmed ? ` (${dayCount(l.unconfirmed)} not confirmed)` : ''}`),
    `Total: ${formatZAR(total)}`,
  ].join('\n')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DayPicker day={weekStart} onDay={onWeek} step={7} />
        <p className="text-sm text-slate-600">Week of <strong>{format(parseISO(weekStart), 'd MMM')} – {format(parseISO(weekEnd), 'd MMM yyyy')}</strong></p>
      </div>
      {pending > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {dayCount(pending)} {pending === 1 ? 'is' : 'are'} only booked, not confirmed. They are counted below; tick them on the Day tab before paying.
        </p>
      )}
      <Card title="Wage list" padded={false} actions={
        <span className="flex gap-2">
          <Button size="sm" onClick={() => void navigator.clipboard?.writeText(text)}><Copy size={14} /> Copy</Button>
          <Button size="sm" onClick={() => window.print()}><Printer size={14} /> Print</Button>
        </span>
      }>
        {lines.length === 0 ? (
          <EmptyState title="Nobody worked this week">Nothing booked or registered between these dates.</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium tracking-wide text-slate-400 uppercase">
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-4 py-2 font-medium">Sites</th>
                <th className="px-4 py-2 text-right font-medium">Days</th>
                <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Day cost</th>
                <th className="px-4 py-2 text-right font-medium">To pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.worker_id}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-slate-800">{l.worker?.name ?? 'Worker'}</span>
                    <span className="block text-xs text-slate-500">
                      {days.filter((d) => d.worker_id === l.worker_id && d.days > 0).sort((x, y) => x.day.localeCompare(y.day)).map((d) => `${format(parseISO(d.day), 'EEE')}${d.days === 0.5 ? ' ½' : ''}${d.confirmed ? '' : '*'}`).join(' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{l.sites.map(site).join(', ')}</td>
                  <td className="tabular px-4 py-2.5 text-right">
                    {l.confirmed + l.unconfirmed}
                    {l.unconfirmed > 0 && <span className="block text-[11px] text-amber-700">{l.unconfirmed} not confirmed</span>}
                  </td>
                  <td className="tabular hidden px-4 py-2.5 text-right text-slate-500 sm:table-cell">{formatZAR(l.worker?.day_cost ?? 0, { decimals: 0 })}</td>
                  <td className="tabular px-4 py-2.5 text-right font-semibold">{formatZAR(l.amount)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-2.5" colSpan={2}>Total</td>
                <td className="tabular px-4 py-2.5 text-right">{lines.reduce((t, l) => t + l.confirmed + l.unconfirmed, 0)}</td>
                <td className="hidden sm:table-cell" />
                <td className="tabular px-4 py-2.5 text-right">{formatZAR(total)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
      <p className="text-xs text-slate-500">* booked, not confirmed. ½ a half day. Each day is paid at the rate it was registered at. These wages are already in each job's labour cost, so do not also capture them as slips on a project.</p>
    </div>
  )
}
