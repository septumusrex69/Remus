import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarRange, Plus, Trash2, UserPlus, X } from 'lucide-react'
import {
  expenses as expensesApi,
  planProjectFromQuote,
  projectStages,
  projects as projectsApi,
  stageBookings,
  workers as workersApi,
  listCrewDays,
} from '../../../lib/api'
import { formatDate, formatZAR, round2, todayYmd } from '../../../lib/format'
import { clashesFor, stageActual } from '../../../lib/projectPlan'
import { nextWorkingDay, workingDaysBetween, workingDaysIn } from '../../../lib/workdays'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, Spinner } from '../../../components/ui'
import type { Project, ProjectStage, Quote, StageBooking, Worker } from '../../../types'
import { WorkerModal } from '../workers/WorkersPage'
import { seesBudget, seesMoney, useAccess } from '../../../lib/access'

/**
 * A project's plan and crew (Stephan, 26 Oct 2026): the accepted quote's stages on real dates,
 * who is booked on each (with a warning when someone is already booked elsewhere those days), and
 * each stage's quoted cost against what it has cost so far.
 */

async function load(projectId: string, since: string) {
  const [stages, allStages, bookings, workers, expenses, projects, register] = await Promise.all([
    projectStages.list({ project_id: projectId }),
    projectStages.list(),
    stageBookings.list(),
    workersApi.list(),
    expensesApi.list({ project_id: projectId }),
    projectsApi.list(),
    // Every site's register, not only this one's: a person registered elsewhere on a booked day was not here.
    listCrewDays(since, todayYmd()),
  ])
  return { stages, allStages, bookings, workers, expenses, projects, register }
}

const label = (name: string) => name || 'General'
const short = (d: string | null) => (d ? formatDate(d, 'd MMM') : '—')

export function PlanTab({ project, quote, onProjectChanged }: { project: Project; quote: Quote | null; onProjectChanged: () => void }) {
  const { data, error, loading, reload } = useLoad(() => load(project.id, project.start_date ?? '2000-01-01'), [project.id], `plan:${project.id}`)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [start, setStart] = useState(() => nextWorkingDay(project.start_date ?? todayYmd()))
  const [newWorkerFor, setNewWorkerFor] = useState<string | null>(null)
  const today = todayYmd()
  // Who sees what (lib/access.ts): rand for Administrators, percentages for contractors, neither for site managers.
  const access = useAccess()
  const money = seesMoney(access)
  const budget = seesBudget(access)

  const ctx = useMemo(() => {
    if (!data) return null
    const workerById = new Map(data.workers.map((w) => [w.id, w]))
    const stageById = new Map(data.allStages.map((s) => [s.id, s]))
    const projectName = new Map(data.projects.map((p) => [p.id, p.code || p.name]))
    const crew = { bookings: data.bookings, register: data.register, stageProject: new Map(data.allStages.map((s) => [s.id, s.project_id])), workers: workerById }
    return { workerById, stageById, projectName, crew }
  }, [data])

  if (loading && !data) return <Spinner />
  if (!data || !ctx) return <ErrorBanner error={error} />

  async function run(labelText: string, fn: () => Promise<unknown>) {
    setBusy(labelText)
    setErr(null)
    try {
      await fn()
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const stages = data.stages
  const planFromQuote = () =>
    run('plan', async () => {
      if (stages.length && !window.confirm('Make the plan again from the quote? The current stages and their bookings are replaced.')) return
      await planProjectFromQuote(project.id, quote!.id, start)
      onProjectChanged()
    })

  // ---------- No plan yet ----------
  if (stages.length === 0) {
    return (
      <Card title="Plan & crew">
        <ErrorBanner error={err} />
        {quote ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Put quote <strong>{quote.number}</strong>'s stages on the calendar. Each stage gets real dates from the start date, skipping weekends and public holidays.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="label">Start date</span>
                <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value || today)} />
              </label>
              <Button variant="primary" onClick={planFromQuote} loading={busy === 'plan'}><CalendarRange size={15} /> Make the plan</Button>
            </div>
          </div>
        ) : (
          <EmptyState title="No plan yet">This project wasn't made from a quote. Add stages by hand.</EmptyState>
        )}
        <div className="mt-4">
          <Button size="sm" onClick={() => run('add', () => projectStages.create({ project_id: project.id, name: 'Stage 1', sort_order: 0, start_date: start, end_date: start }))}>
            <Plus size={13} /> Add a stage by hand
          </Button>
        </div>
      </Card>
    )
  }

  // ---------- The plan ----------
  const first = stages.map((s) => s.start_date).filter(Boolean).sort()[0] as string | undefined
  const last = stages.map((s) => s.end_date).filter(Boolean).sort().reverse()[0] as string | undefined
  const days = first && last ? workingDaysIn(first, last) : []
  const myStageIds = new Set(stages.map((s) => s.id))
  const myBookings = data.bookings.filter((b) => myStageIds.has(b.stage_id))
  const active = data.workers.filter((w) => w.active)

  const totals = stages.reduce(
    (t, s) => {
      const a = stageActual(s.id, data.expenses, ctx.crew, today)
      const q = Number(s.quoted_material) + Number(s.quoted_labour) + Number(s.quoted_subcontractor)
      return { quoted: t.quoted + q, actual: t.actual + a.total, sell: t.sell + Number(s.quoted_sell) }
    },
    { quoted: 0, actual: 0, sell: 0 },
  )
  // Slips on the project that aren't filed on a stage still cost money; shown so nothing hides.
  const unfiled = round2(data.expenses.filter((e) => !e.stage_id).reduce((t, e) => t + Number(e.amount_excl), 0))

  function book(stage: ProjectStage, workerId: string) {
    if (!stage.start_date || !stage.end_date) return
    const w = ctx!.workerById.get(workerId)
    const draft = { id: '', worker_id: workerId, start_date: stage.start_date, end_date: stage.end_date }
    const clash = clashesFor(draft, data!.bookings)
    if (clash.length) {
      const where = clash.map((c) => describe(c)).join(', ')
      if (!window.confirm(`${w?.name ?? 'This worker'} is already booked on ${where}. Book them here as well?`)) return
    }
    void run('book', () => stageBookings.create({ stage_id: stage.id, worker_id: workerId, start_date: stage.start_date!, end_date: stage.end_date! }))
  }

  function describe(b: StageBooking): string {
    const s = ctx!.stageById.get(b.stage_id)
    const p = s ? ctx!.projectName.get(s.project_id) : null
    return `${p ?? 'another job'}${s?.name ? ` (${s.name})` : ''}, ${short(b.start_date)}–${short(b.end_date)}`
  }

  async function moveStage(stage: ProjectStage, patch: Partial<ProjectStage>) {
    const next = { ...stage, ...patch }
    if (next.start_date && next.end_date && next.end_date < next.start_date) next.end_date = next.start_date
    await run('move', async () => {
      await projectStages.update(stage.id, { start_date: next.start_date, end_date: next.end_date })
      // Bookings that spanned the whole stage follow it.
      for (const b of myBookings.filter((x) => x.stage_id === stage.id && x.start_date === stage.start_date && x.end_date === stage.end_date)) {
        await stageBookings.update(b.id, { start_date: next.start_date!, end_date: next.end_date! })
      }
      const all = (await projectStages.list({ project_id: project.id })).filter((s) => s.start_date && s.end_date)
      if (all.length) {
        await projectsApi.update(project.id, {
          start_date: all.map((s) => s.start_date!).sort()[0],
          end_date: all.map((s) => s.end_date!).sort().reverse()[0],
        })
        onProjectChanged()
      }
    })
  }

  return (
    <div className="space-y-4">
      <ErrorBanner error={err} />

      {/* ---------- Timeline ---------- */}
      <Card
        title="Plan & crew"
        subtitle={first && last ? `${formatDate(first, 'EEE d MMM')} to ${formatDate(last, 'EEE d MMM yyyy')} · ${days.length} working day${days.length === 1 ? '' : 's'}` : undefined}
        actions={
          <>
            {quote && (
              <span className="flex items-center gap-1.5">
                <input type="date" className="input w-auto py-1 text-xs" value={start} onChange={(e) => setStart(e.target.value || today)} aria-label="Start date" />
                <Button size="sm" variant="ghost" onClick={planFromQuote} loading={busy === 'plan'}>Re-plan from quote</Button>
              </span>
            )}
            <Button size="sm" onClick={() => run('add', () => projectStages.create({ project_id: project.id, name: `Stage ${stages.length + 1}`, sort_order: stages.length, start_date: last ?? start, end_date: last ?? start }))}>
              <Plus size={13} /> Stage
            </Button>
          </>
        }
      >
        {days.length > 0 && (
          <div className="overflow-x-auto">
            <div className="min-w-[32rem] space-y-1.5">
              {stages.map((s) => {
                const i0 = s.start_date ? days.indexOf(nextWorkingDay(s.start_date)) : -1
                const n = s.start_date && s.end_date ? workingDaysBetween(s.start_date, s.end_date) : 0
                const crew = myBookings.filter((b) => b.stage_id === s.id)
                return (
                  <div key={s.id} className="grid grid-cols-[8rem_1fr] items-center gap-2">
                    <span className="truncate text-sm text-slate-700" title={label(s.name)}>{label(s.name)}</span>
                    <div className="relative h-7 rounded bg-slate-100">
                      {days.map((d, i) => (d === today ? <span key={d} className="absolute inset-y-0 w-0.5 bg-red-400" style={{ left: `${((i + 0.5) / days.length) * 100}%` }} title="Today" /> : null))}
                      {i0 >= 0 && n > 0 && (
                        <div
                          className={`absolute inset-y-0.5 flex items-center overflow-hidden rounded px-1.5 text-[11px] font-medium whitespace-nowrap text-white ${s.end_date && s.end_date < today ? 'bg-slate-400' : 'bg-brand-500'}`}
                          style={{ left: `${(i0 / days.length) * 100}%`, width: `${(n / days.length) * 100}%` }}
                          title={`${short(s.start_date)} to ${short(s.end_date)}`}
                        >
                          {short(s.start_date)}{n > 1 ? `–${short(s.end_date)}` : ''}{crew.length ? ` · ${crew.length} crew` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      {/* ---------- Stages: dates, crew, quoted vs actual ---------- */}
      {stages.map((s) => {
        const crew = myBookings.filter((b) => b.stage_id === s.id)
        const a = stageActual(s.id, data.expenses, ctx.crew, today)
        const quoted = round2(Number(s.quoted_material) + Number(s.quoted_labour) + Number(s.quoted_subcontractor))
        const over = a.total > quoted && quoted > 0
        const pct = quoted > 0 ? Math.min(100, (a.total / quoted) * 100) : 0
        const free = active.filter((w) => !crew.some((b) => b.worker_id === w.id))
        return (
          <section key={s.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <input
                className="input w-auto max-w-[14rem] py-1 font-semibold"
                defaultValue={s.name}
                onBlur={(e) => e.target.value.trim() !== s.name && run('rename', () => projectStages.update(s.id, { name: e.target.value.trim() }))}
                aria-label="Stage name"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                From <input type="date" className="input w-auto py-1 text-xs" value={s.start_date ?? ''} onChange={(e) => e.target.value && moveStage(s, { start_date: e.target.value })} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                to <input type="date" className="input w-auto py-1 text-xs" value={s.end_date ?? ''} onChange={(e) => e.target.value && moveStage(s, { end_date: e.target.value })} />
              </label>
              <span className="text-xs text-slate-500">{s.start_date && s.end_date ? `${workingDaysBetween(s.start_date, s.end_date)} working days` : ''}</span>
              <button
                className="ml-auto rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => window.confirm(`Delete the stage "${label(s.name)}" and its bookings?`) && run('del', () => projectStages.remove(s.id))}
                aria-label="Delete stage"
                title="Delete stage"
              >
                <Trash2 size={14} />
              </button>
            </header>

            <div className={`grid gap-4 p-4 ${budget ? 'md:grid-cols-2' : ''}`}>
              {/* Crew */}
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Crew</p>
                {crew.length === 0 && <p className="mb-2 text-sm text-slate-500">Nobody booked yet.</p>}
                <ul className="mb-2 space-y-1.5">
                  {crew.map((b) => {
                    const w = ctx.workerById.get(b.worker_id)
                    const clash = clashesFor(b, data.bookings)
                    return (
                      <li key={b.id} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${clash.length ? 'bg-red-50 ring-1 ring-red-200' : 'bg-slate-50'}`}>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-slate-800">{w?.name ?? 'Worker'}</span>
                          <span className="text-xs text-slate-500"> · {w?.grade === 'junior' ? 'Junior' : 'Senior'} · {short(b.start_date)}–{short(b.end_date)}</span>
                          {clash.length > 0 && (
                            <span className="mt-0.5 flex items-start gap-1 text-xs text-red-700">
                              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> Also booked on {clash.map(describe).join('; ')}
                            </span>
                          )}
                        </span>
                        <button className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600" onClick={() => run('unbook', () => stageBookings.remove(b.id))} aria-label="Take off this stage" title="Take off this stage">
                          <X size={14} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex flex-wrap items-center gap-2">
                  <UserPlus size={15} className="text-slate-400" />
                  <select
                    className="input w-auto max-w-[16rem] py-1 text-sm"
                    value=""
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === '__new') setNewWorkerFor(s.id)
                      else if (v) book(s, v)
                    }}
                    aria-label="Book a worker"
                  >
                    <option value="">Book a worker…</option>
                    {free.map((w) => {
                      const busyElsewhere = s.start_date && s.end_date && clashesFor({ id: '', worker_id: w.id, start_date: s.start_date, end_date: s.end_date }, data.bookings).length > 0
                      return <option key={w.id} value={w.id}>{w.name} ({w.grade}){busyElsewhere ? ' · busy elsewhere' : ''}</option>
                    })}
                    <option value="__new">+ New worker…</option>
                  </select>
                </div>
              </div>

              {/* Quoted vs actual: rand for Administrators; a contractor gets the bar and the percentage. */}
              {budget && !money && (
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Budget</p>
                  <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full ${over ? 'bg-red-500' : pct >= 90 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`text-sm ${over ? 'font-semibold text-red-700' : 'text-slate-700'}`}>
                    {quoted > 0 ? (over ? `Over this stage's budget (${Math.round((a.total / quoted) * 100)}% used).` : `${Math.round(pct)}% of this stage's budget used.`) : 'No budget for this stage.'}
                  </p>
                  {a.labourDays ? <p className="mt-1 text-xs text-slate-500">Labour: {a.labourDays} worker-day{a.labourDays === 1 ? '' : 's'} worked so far.</p> : null}
                </div>
              )}
              {money && <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Quoted cost vs actual so far</p>
                <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full ${over ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <table className="tabular w-full text-sm">
                  <tbody>
                    {([
                      ['Materials', s.quoted_material, a.material],
                      ['Labour', s.quoted_labour, a.labour],
                      ['Subcontractors', s.quoted_subcontractor, a.subcontractor],
                    ] as const).map(([k, q, act]) => (
                      <tr key={k}>
                        <td className="py-0.5 text-slate-500">{k}</td>
                        <td className="py-0.5 text-right text-slate-500">{formatZAR(Number(q), { decimals: 0 })}</td>
                        <td className={`py-0.5 text-right ${act > Number(q) && Number(q) > 0 ? 'font-semibold text-red-700' : 'text-slate-800'}`}>{formatZAR(act, { decimals: 0 })}</td>
                      </tr>
                    ))}
                    {a.other > 0 && (
                      <tr><td className="py-0.5 text-slate-500">Other (transport, hire…)</td><td /><td className="py-0.5 text-right text-slate-800">{formatZAR(a.other, { decimals: 0 })}</td></tr>
                    )}
                    <tr className="border-t border-slate-200 font-semibold">
                      <td className="pt-1">Total</td>
                      <td className="pt-1 text-right text-slate-600">{formatZAR(quoted, { decimals: 0 })}</td>
                      <td className={`pt-1 text-right ${over ? 'text-red-700' : 'text-emerald-700'}`}>{formatZAR(a.total, { decimals: 0 })}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-1.5 text-xs text-slate-500">
                  {over ? `Over the quoted cost by ${formatZAR(round2(a.total - quoted), { decimals: 0 })}.` : quoted > 0 ? `${formatZAR(round2(quoted - a.total), { decimals: 0 })} left of the quoted cost.` : ''}
                  {a.labourDays ? ` Labour: ${a.labourDays} worker-day${a.labourDays === 1 ? '' : 's'} worked so far.` : ''}
                </p>
              </div>}
            </div>
          </section>
        )
      })}

      {/* ---------- The whole project (Administrators: lib/access.ts) ---------- */}
      {money && <Card title="The whole project">
        <div className="tabular grid gap-3 text-sm sm:grid-cols-4">
          <Figure label="Client pays (stages)" value={formatZAR(totals.sell, { decimals: 0 })} />
          <Figure label="Quoted cost" value={formatZAR(totals.quoted, { decimals: 0 })} />
          <Figure label="Actual so far" value={formatZAR(totals.actual + unfiled, { decimals: 0 })} tone={totals.actual + unfiled > totals.quoted ? 'bad' : 'good'} />
          <Figure label="Profit if it ends now" value={formatZAR(totals.sell - totals.actual - unfiled, { decimals: 0 })} tone={totals.sell - totals.actual - unfiled < 0 ? 'bad' : 'good'} />
        </div>
        {unfiled > 0 && (
          <p className="mt-3 text-xs text-amber-800">
            {formatZAR(unfiled)} of this project's slips aren't filed on a stage, so they count in the project's total but not in any stage. Pick the stage when you capture a slip.
          </p>
        )}
      </Card>}

      {newWorkerFor && (
        <WorkerModal
          initial={{ grade: 'senior', active: true }}
          onClose={() => setNewWorkerFor(null)}
          onSaved={(w: Worker) => {
            const s = stages.find((x) => x.id === newWorkerFor)
            setNewWorkerFor(null)
            if (s?.start_date && s.end_date) void run('book', () => stageBookings.create({ stage_id: s.id, worker_id: w.id, start_date: s.start_date!, end_date: s.end_date! }))
            else reload()
          }}
        />
      )}
    </div>
  )
}

function Figure({ label: l, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{l}</p>
      <p className={`mt-0.5 text-lg font-semibold ${tone === 'bad' ? 'text-red-700' : tone === 'good' ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</p>
    </div>
  )
}
