import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, format, startOfWeek } from 'date-fns'
import { AlertTriangle, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { projectStages, projects as projectsApi, stageBookings, workers as workersApi } from '../../../lib/api'
import { formatDate, todayYmd, ymd } from '../../../lib/format'
import { workingDaysIn } from '../../../lib/workdays'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '../../../components/ui'
import { paths } from '../paths'

/**
 * Who is where, day by day (Stephan, 26 Oct 2026: "schedule this in our overall diary... which
 * team, and that teams are not overbooked"). Two working weeks at a time: a row per worker, a
 * column per working day, the job in each cell, and red where someone is booked on two jobs.
 */

async function load() {
  const [workers, stages, bookings, projects] = await Promise.all([workersApi.list(), projectStages.list(), stageBookings.list(), projectsApi.list()])
  return { workers, stages, bookings, projects }
}

/** A steady colour per project, from the skin's palette, so a job reads the same across the grid. */
const PALETTE = ['bg-brand-100 text-brand-800', 'bg-emerald-100 text-emerald-800', 'bg-sky-100 text-sky-800', 'bg-amber-100 text-amber-900', 'bg-violet-100 text-violet-800', 'bg-slate-200 text-slate-800']

export function SchedulePage() {
  const { data, error, loading } = useLoad(load, [], 'schedule')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const today = todayYmd()
  const from = ymd(weekStart)
  const to = ymd(addDays(weekStart, 13))
  const days = useMemo(() => workingDaysIn(from, to), [from, to])

  const view = useMemo(() => {
    if (!data) return null
    const stageById = new Map(data.stages.map((s) => [s.id, s]))
    const projectById = new Map(data.projects.map((p) => [p.id, p]))
    const colour = new Map<string, string>()
    for (const p of data.projects) colour.set(p.id, PALETTE[colour.size % PALETTE.length])
    const inView = data.bookings.filter((b) => b.start_date <= to && b.end_date >= from)
    const booked = new Set(inView.map((b) => b.worker_id))
    const rows = data.workers.filter((w) => w.active || booked.has(w.id))
    const cell = (workerId: string, day: string) =>
      inView
        .filter((b) => b.worker_id === workerId && b.start_date <= day && b.end_date >= day)
        .map((b) => {
          const s = stageById.get(b.stage_id)
          const p = s ? projectById.get(s.project_id) : undefined
          return { b, s, p }
        })
    // Stages running in this window with nobody booked: work that has no crew yet.
    const uncrewed = data.stages
      .filter((s) => s.start_date && s.end_date && s.start_date <= to && s.end_date >= from)
      .filter((s) => !data.bookings.some((b) => b.stage_id === s.id))
      .map((s) => ({ s, p: projectById.get(s.project_id) }))
      .filter((x) => x.p && x.p.status !== 'cancelled' && x.p.status !== 'completed')
      .sort((a, b) => (a.s.start_date ?? '').localeCompare(b.s.start_date ?? ''))
    let clashes = 0
    for (const w of rows) for (const d of days) if (cell(w.id, d).length > 1) clashes += 1
    return { rows, cell, colour, uncrewed, clashes }
  }, [data, from, to, days])

  if (loading && !data) return <Spinner page />
  if (!data || !view) return <ErrorBanner error={error} />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Schedule"
        subtitle="Who is on which job, day by day. Book people in a project's Plan & crew tab."
        actions={
          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => setWeekStart((d) => addDays(d, -14))} aria-label="Earlier"><ChevronLeft size={15} /></Button>
            <Button size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>This week</Button>
            <Button size="sm" onClick={() => setWeekStart((d) => addDays(d, 14))} aria-label="Later"><ChevronRight size={15} /></Button>
          </div>
        }
      />
      <ErrorBanner error={error} />

      {view.clashes > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={17} className="shrink-0" />
          {view.clashes} day{view.clashes === 1 ? '' : 's'} where someone is booked on two jobs. They are marked in red below.
        </div>
      )}

      <Card title={`${formatDate(from, 'd MMM')} to ${formatDate(to, 'd MMM yyyy')}`} padded={false}>
        {view.rows.length === 0 ? (
          <EmptyState title="No workers yet" icon={<CalendarRange size={30} />}>
            Add your team under <Link to={paths.workers()} className="text-brand-700 underline">Workers</Link>, then book them on a project's Plan & crew tab.
          </EmptyState>
        ) : (
          <>
          {/*
            ON A PHONE, DAY BY DAY (Remus · Handover 5): a worker-by-day grid is a table to scroll sideways on a
            phone, and a site manager asks the other question anyway -- who is where today, and tomorrow. Each
            day lists its sites and the people on them; somebody on two jobs that day is red.
          */}
          <ol className="divide-y divide-slate-100 sm:hidden" data-testid="schedule-days">
            {days.map((d) => {
              const bySite = new Map<string, { p: (typeof data.projects)[number] | undefined; people: { name: string; clash: boolean; stage: string }[] }>()
              for (const w of view.rows) {
                const c = view.cell(w.id, d)
                for (const { s, p } of c) {
                  const key = p?.id ?? 'none'
                  const site = bySite.get(key) ?? { p, people: [] }
                  site.people.push({ name: w.name, clash: c.length > 1, stage: s?.name ?? '' })
                  bySite.set(key, site)
                }
              }
              const past = d < today
              return (
                <li key={d} className={`px-4 py-3 ${d === today ? 'bg-brand-50/60' : ''} ${past ? 'opacity-60' : ''}`}>
                  <p className={`text-xs font-bold tracking-wide uppercase ${d === today ? 'text-brand-700' : 'text-slate-500'}`}>
                    {d === today ? 'Today · ' : ''}{format(new Date(`${d}T00:00:00`), 'EEEE d MMM')}
                  </p>
                  {bySite.size === 0 ? (
                    <p className="mt-1 text-sm text-slate-400">Nobody booked.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-2">
                      {[...bySite.values()].map(({ p, people }) => (
                        <li key={p?.id ?? 'none'}>
                          <Link to={p ? paths.project(p.id, 'plan') : paths.projects()} className="block rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                            <span className="block text-sm font-semibold text-slate-800">{p?.name ?? 'Job'}</span>
                            {p?.site_address && <span className="block truncate text-xs text-slate-500">{p.site_address}</span>}
                            <span className="mt-1 flex flex-wrap gap-1">
                              {people.map((x) => (
                                <span key={x.name} className={`rounded px-1.5 py-0.5 text-xs font-medium ${x.clash ? 'bg-red-100 text-red-800 ring-1 ring-red-300' : 'bg-slate-100 text-slate-700'}`}>
                                  {x.name}{x.clash ? ' · also elsewhere' : ''}
                                </span>
                              ))}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[46rem] table-fixed border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <th className="sticky left-0 z-10 w-36 bg-slate-50 px-3 py-2 text-left font-medium">Worker</th>
                  {days.map((d) => (
                    <th key={d} className={`px-1 py-2 text-center font-medium ${d === today ? 'bg-brand-50 text-brand-700' : ''}`}>
                      <span className="block">{format(new Date(`${d}T00:00:00`), 'EEE')}</span>
                      <span className="block text-[11px]">{format(new Date(`${d}T00:00:00`), 'd MMM')}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((w) => (
                  <tr key={w.id} className="border-t border-slate-100">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2">
                      <span className="block truncate text-sm font-medium text-slate-800">{w.name}</span>
                      <span className="block text-[11px] text-slate-500">{w.grade === 'junior' ? 'Junior' : 'Senior'}{w.trade ? ` · ${w.trade}` : ''}</span>
                    </td>
                    {days.map((d) => {
                      const c = view.cell(w.id, d)
                      const clash = c.length > 1
                      return (
                        <td key={d} className={`px-0.5 py-1 align-top ${d === today ? 'bg-brand-50/50' : ''}`}>
                          {c.map(({ b, s, p }) => (
                            <Link
                              key={b.id}
                              to={p ? paths.project(p.id, 'plan') : paths.projects()}
                              title={`${p?.name ?? ''}${s?.name ? ` · ${s.name}` : ''}`}
                              className={`mb-0.5 block truncate rounded px-1 py-0.5 text-[11px] font-medium ${clash ? 'bg-red-100 text-red-800 ring-1 ring-red-300' : view.colour.get(p?.id ?? '') ?? PALETTE[0]}`}
                            >
                              {p?.code || p?.name || 'Job'}
                            </Link>
                          ))}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <Card title="Stages with nobody booked" subtitle="Running in these two weeks, with no crew yet." padded={false}>
        {view.uncrewed.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">Every stage in these two weeks has someone booked.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {view.uncrewed.map(({ s, p }) => (
              <li key={s.id}>
                <Link to={paths.project(p!.id, 'plan')} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{p!.name}{s.name ? ` · ${s.name}` : ''}</span>
                    <span className="block text-xs text-slate-500">{formatDate(s.start_date, 'EEE d MMM')} to {formatDate(s.end_date, 'EEE d MMM')}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-brand-700">Book crew →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
