import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { addMonths } from 'date-fns'
import { listAllStages, listEventsBetween, listProfiles, projects as projectsApi, stageBookings, workers as workersApi } from '../../../lib/api'
import { listTasksBetween } from '../../../lib/tasksApi'
import { CAL_KINDS, buildCalendar, edgeOf, itemsOn, runDay, type CalItem, type CalKind } from '../../../lib/calendarItems'
import { localDay, shiftDay, weekStrip } from '../../../lib/tasks'
import { formatDate } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { useAccess } from '../../../lib/access'
import { useAuth } from '../../../store/AuthContext'
import { Card, ErrorBanner, Spinner } from '../../../components/ui'
import { EventFormModal } from '../components/EventFormModal'
import { Avatar } from '../tasks/TaskList'
import { paths } from '../paths'
import type { DiaryEvent } from '../../../types'

/**
 * THE CALENDAR (Remus · Handover 8), copied from Raptor's `pages/calendar/CalendarPage.tsx`.
 *
 * Stephan, 7 Nov 2026: "Calendar as well." One calendar with everything that has a day on it, together: tasks,
 * diary events, the job stages and the crew booked onto them, and when each job starts and finishes. Raptor's
 * shape kept: Month / Week / Day, back / forward / Today, a whose-work filter that starts on your own for everyone
 * but an Administrator, a count on each busy square, the whole square opening that day's tasks ("a target nobody
 * can hit is not a feature"), and a diary event opening in place rather than navigating away (Raptor's meetings).
 *
 * DIFFERENT FROM RAPTOR: weeks start on Monday (the Diary's and SA calendars'); a stage or booking runs for days,
 * so the month shows it where it starts and ends and the week and day show every day of it (lib/calendarItems.ts);
 * "Show" ticks turn each kind on and off, because five kinds on one grid is a lot on a phone. No money anywhere,
 * so a site manager sees the same calendar as everybody (lib/access.ts).
 */
type ViewMode = 'Month' | 'Week' | 'Day'
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/* One colour per kind, in skin tokens so every skin follows (Raptor gives each kind its own colour too). */
const KIND_TONE: Record<CalKind, string> = {
  task: 'bg-brand-100 text-brand-900',
  diary: 'bg-ink-950 text-white',
  stage: 'bg-emerald-50 text-emerald-800',
  crew: 'bg-slate-100 text-slate-700',
  project: 'bg-brand-500 text-white',
}
const KIND_DOT: Record<CalKind, string> = {
  task: 'bg-brand-300', diary: 'bg-ink-950', stage: 'bg-emerald-500', crew: 'bg-slate-400', project: 'bg-brand-500',
}

const tasksForDay = (day: string) => `${paths.tasks()}?date=${day}`

export function CalendarPage() {
  const { currentUser } = useAuth()
  const access = useAccess()
  const [view, setView] = useState<ViewMode>(() => (window.innerWidth < 640 ? 'Day' : 'Month'))
  const [cursor, setCursor] = useState(() => localDay(new Date()))
  // Raptor's useDefaultOwnerFilter: your own work first, everybody's for an Administrator.
  const [owner, setOwner] = useState<string>(() => (access === 'admin' || access === 'read_only' ? 'All' : currentUser?.id ?? 'All'))
  const [show, setShow] = useState<Record<CalKind, boolean>>({ task: true, diary: true, stage: true, crew: true, project: true })
  const [openEvent, setOpenEvent] = useState<DiaryEvent | null>(null)
  const today = localDay(new Date())

  // The days on screen (the month's six weeks, or the cursor's week), a day either side for time zones. Stages,
  // bookings and projects are few and loaded whole; tasks and diary events are fetched for the range.
  const range = useMemo(() => {
    const first = view === 'Month' ? `${cursor.slice(0, 7)}-01` : cursor
    const from = weekStrip(first, 1)[0]
    return { from: shiftDay(from, -1), to: shiftDay(from, view === 'Month' ? 43 : 8) }
  }, [cursor, view])

  const { data, error, loading, reload } = useLoad(async () => {
    const fromIso = new Date(`${range.from}T00:00:00`).toISOString()
    const toIso = new Date(`${range.to}T00:00:00`).toISOString()
    const [tasks, events, stages, bookings, workers, projects, team] = await Promise.all([
      listTasksBetween(fromIso, toIso).catch(() => []),
      listEventsBetween(fromIso, toIso),
      listAllStages(),
      stageBookings.list(),
      workersApi.list(),
      projectsApi.list(),
      listProfiles(),
    ])
    return { tasks, events, stages, bookings, workers, projects, team }
  }, [range.from, range.to], 'calendar')

  const items = useMemo(() => {
    if (!data) return []
    const live = new Set(data.projects.filter((p) => p.status !== 'cancelled').map((p) => p.id))
    return buildCalendar({
      tasks: data.tasks, events: data.events, stages: data.stages.filter((s) => live.has(s.project_id)),
      bookings: data.bookings, workers: data.workers, projects: data.projects.filter((p) => live.has(p.id)),
    }).filter((i) => show[i.kind] && (owner === 'All' || i.ownerId === null || i.ownerId === owner))
  }, [data, show, owner])

  function shift(n: number) {
    const c = new Date(`${cursor}T12:00:00`)
    if (view === 'Month') setCursor(localDay(addMonths(c, n)))
    else setCursor(shiftDay(cursor, view === 'Week' ? 7 * n : n))
  }

  const title = view === 'Month'
    ? formatDate(cursor, 'MMMM yyyy')
    : view === 'Day' ? formatDate(cursor, 'EEEE d MMMM yyyy') : `Week of ${formatDate(weekStrip(cursor, 1)[0], 'd MMM yyyy')}`

  const onItem = (i: CalItem) => setOpenEvent(i.diary ?? null)

  return (
    <div className="space-y-4" data-testid="calendar-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => shift(-1)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Earlier"><ChevronLeft size={16} /></button>
          <h2 className="min-w-0 truncate text-base font-semibold text-slate-800 sm:w-64" data-testid="calendar-title">{title}</h2>
          <button type="button" onClick={() => shift(1)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Later"><ChevronRight size={16} /></button>
          <button type="button" onClick={() => setCursor(today)} className="ml-1 text-xs font-medium text-brand-700 hover:underline">Today</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="max-w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none" aria-label="Whose">
            <option value="All">Everybody</option>
            {(data?.team ?? []).filter((p) => p.status === 'Active').map((p) => <option key={p.id} value={p.id}>{p.id === currentUser?.id ? 'Mine' : p.name || p.email}</option>)}
          </select>
          <div className="flex items-center rounded-lg bg-slate-100 p-1">
            {(['Day', 'Week', 'Month'] as ViewMode[]).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} data-testid={`calendar-view-${v.toLowerCase()}`}
                className={clsx('rounded-md px-3 py-1.5 text-xs font-medium', view === v ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500')}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-600" data-testid="calendar-kinds">
        <span className="text-slate-400">Show</span>
        {CAL_KINDS.map((k) => (
          <label key={k.id} className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={show[k.id]} onChange={(e) => setShow({ ...show, [k.id]: e.target.checked })} />
            <span className={clsx('h-2 w-2 rounded-full', KIND_DOT[k.id])} /> {k.label}
          </label>
        ))}
      </div>

      <ErrorBanner error={error} />
      {loading && !data ? <Spinner /> : (
        <>
          {view === 'Month' && <MonthView cursor={cursor} today={today} items={items} onItem={onItem} />}
          {view === 'Week' && <WeekView cursor={cursor} today={today} items={items} onItem={onItem} />}
          {view === 'Day' && <DayView cursor={cursor} items={items} onItem={onItem} team={data?.team ?? []} />}
        </>
      )}

      <EventFormModal
        open={!!openEvent}
        editing={openEvent}
        projects={data?.projects ?? []}
        team={data?.team ?? []}
        onClose={() => setOpenEvent(null)}
        onSaved={() => { setOpenEvent(null); reload() }}
      />
    </div>
  )
}

/** Where a chip goes: a diary event opens in place; a task opens its day's list; job things open the job's plan. */
function Chip({ item, onItem, className, title, children }: { item: CalItem; onItem: (i: CalItem) => void; className: string; title?: string; children: React.ReactNode }) {
  if (item.diary) {
    return <button type="button" onClick={() => onItem(item)} className={clsx(className, 'w-full text-left')} title={title} data-testid="calendar-chip">{children}</button>
  }
  const to = item.kind === 'task' ? tasksForDay(item.start) : item.projectId ? paths.project(item.projectId, item.kind === 'project' ? undefined : 'plan') : paths.calendar()
  return <Link to={to} className={className} title={title} data-testid="calendar-chip">{children}</Link>
}

const edgeWord = (i: CalItem, day: string) => {
  const e = edgeOf(i, day)
  return e === 'starts' ? 'starts' : e === 'ends' ? 'ends' : null
}
const chipTitle = (i: CalItem, day: string) => [i.time, i.title, i.sub, edgeWord(i, day) ?? runDay(i, day)].filter(Boolean).join(' · ')

function MonthView({ cursor, today, items, onItem }: { cursor: string; today: string; items: CalItem[]; onItem: (i: CalItem) => void }) {
  const month = cursor.slice(0, 7)
  const days = weekStrip(`${month}-01`, 6)
  return (
    <Card padded={false}>
      <div className="grid grid-cols-7 border-b border-slate-100">
        {WEEKDAYS.map((w) => <div key={w} className="py-2.5 text-center text-xs font-medium text-slate-400">{w}</div>)}
      </div>
      <div className="grid grid-cols-7" data-testid="calendar-month">
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month
          const dayItems = itemsOn(items, d, 'month')
          return (
            // THE WHOLE SQUARE OPENS THE DAY (Raptor): an overlay link under the chips, never a link inside a link.
            <div key={d} className={clsx('relative min-h-16 border-r border-b border-slate-50 p-1 sm:min-h-[100px] sm:p-1.5', !inMonth && 'bg-slate-50/40')} data-testid="calendar-day">
              <Link to={tasksForDay(d)} aria-label={`What is on ${formatDate(d, 'd MMMM')}`} className="absolute inset-0 rounded-sm hover:bg-brand-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" />
              <span className={clsx('pointer-events-none relative inline-flex h-6 w-6 items-center justify-center rounded-full text-xs', d === today ? 'bg-brand-500 font-semibold text-white' : inMonth ? 'text-slate-600' : 'text-slate-300')}>
                {Number(d.slice(8))}
              </span>
              {/* How much is on the day, as a number: "on a month grid the load is one digit". Absent at zero. */}
              {dayItems.length > 0 && <span className="pointer-events-none absolute top-1.5 right-1.5 text-[10px] font-semibold text-slate-400 tabular-nums">{dayItems.length}</span>}
              <div className="relative mt-1 hidden space-y-1 sm:block">
                {dayItems.slice(0, 3).map((i) => (
                  <Chip key={i.id} item={i} onItem={onItem} className={clsx('block truncate rounded px-1.5 py-0.5 text-[10px] font-medium hover:brightness-95', KIND_TONE[i.kind], i.done && 'line-through opacity-60')} title={chipTitle(i, d)}>
                    {edgeWord(i, d) && <span className="opacity-75">{edgeWord(i, d) === 'starts' ? '▸ ' : '◂ '}</span>}
                    {i.title}
                  </Chip>
                ))}
                {dayItems.length > 3 && <div className="px-1.5 text-[10px] text-slate-400">+{dayItems.length - 3} more</div>}
              </div>
              {/* On a phone the square is too small for words: a dot a kind, and the square opens the day. */}
              <div className="pointer-events-none relative mt-0.5 flex flex-wrap gap-0.5 sm:hidden">
                {[...new Set(dayItems.map((i) => i.kind))].map((k) => <span key={k} className={clsx('h-1.5 w-1.5 rounded-full', KIND_DOT[k])} />)}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function WeekView({ cursor, today, items, onItem }: { cursor: string; today: string; items: CalItem[]; onItem: (i: CalItem) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-7" data-testid="calendar-week">
      {weekStrip(cursor, 1).map((d) => {
        const dayItems = itemsOn(items, d, 'all')
        return (
          <section key={d} className={clsx('card min-w-0', d === today && 'ring-2 ring-brand-500/40')}>
            <Link to={tasksForDay(d)} className="block border-b border-slate-100 px-3 py-2 text-center hover:bg-slate-50">
              <p className="text-[11px] text-slate-400">{formatDate(d, 'EEE')}</p>
              <p className={clsx('text-sm font-semibold', d === today ? 'text-brand-700' : 'text-slate-700')}>{Number(d.slice(8))}</p>
              <p className="text-[10px] text-slate-400 tabular-nums">{dayItems.length === 0 ? 'Clear' : dayItems.length === 1 ? '1 thing' : `${dayItems.length} things`}</p>
            </Link>
            <div className="space-y-1.5 p-2 sm:min-h-[220px]">
              {dayItems.map((i) => (
                <Chip key={i.id} item={i} onItem={onItem} className={clsx('block rounded px-1.5 py-1 text-[11px] hover:brightness-95', KIND_TONE[i.kind], i.done && 'line-through opacity-60')} title={chipTitle(i, d)}>
                  <span className="block truncate font-semibold">{i.title}</span>
                  <span className="block truncate text-[10px] opacity-80">{[i.time, i.sub, edgeWord(i, d) ?? runDay(i, d)].filter(Boolean).join(' · ')}</span>
                </Chip>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function DayView({ cursor, items, onItem, team }: { cursor: string; items: CalItem[]; onItem: (i: CalItem) => void; team: { id: string; name: string; email: string; avatar_color: string }[] }) {
  const dayItems = itemsOn(items, cursor, 'all')
  return (
    <Card padded={false}>
      <div data-testid="calendar-dayview">
        {dayItems.length === 0 && <p className="py-10 text-center text-sm text-slate-400">Nothing on this day.</p>}
        {dayItems.map((i) => (
          <Chip key={i.id} item={i} onItem={onItem} className="flex items-center gap-3 border-b border-slate-50 px-3 py-1.5 text-[12.5px] last:border-0 hover:bg-slate-50">
            <span className={clsx('h-2 w-2 shrink-0 rounded-full', KIND_DOT[i.kind])} />
            <span className="w-12 shrink-0 text-slate-500 tabular-nums">{i.time ?? ''}</span>
            <span className="min-w-0 flex-1 truncate" title={chipTitle(i, cursor)}>
              <span className={clsx('font-medium text-slate-700', i.done && 'line-through opacity-60')}>{i.title}</span>
              <span className="text-slate-400">{[i.sub, edgeWord(i, cursor) ?? runDay(i, cursor)].filter(Boolean).map((s) => ` · ${s}`).join('')}</span>
            </span>
            {i.ownerId && <Avatar person={team.find((p) => p.id === i.ownerId)} size={18} />}
          </Chip>
        ))}
      </div>
    </Card>
  )
}
