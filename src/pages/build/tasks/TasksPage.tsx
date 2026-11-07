import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarClock, CalendarDays, Plus, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { listEventsBetween, listProfiles } from '../../../lib/api'
import { listTasks, setTaskDone } from '../../../lib/tasksApi'
import { TASK_VIEWS, dayCountSentence, dayCounts, localDay, shiftDay, taskFigures, tasksInView, type Task, type TaskView } from '../../../lib/tasks'
import { formatDate } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { useAccess } from '../../../lib/access'
import { useAuth } from '../../../store/AuthContext'
import { Button, Card, ErrorBanner, Spinner } from '../../../components/ui'
import { paths } from '../paths'
import { CancelTaskModal, RescheduleTaskModal, TaskDayPicker, TaskFormModal } from './TaskForms'
import { TaskList } from './TaskList'

/**
 * TASKS (Remus · Handover 8), copied from Raptor's `pages/tasks/TasksPage.tsx`.
 *
 * Stephan, 7 Nov 2026: "Tasks is a good idea." A to-do list per person: give it to somebody, a due day, done.
 *
 * Raptor's page, kept: the four figures (Overdue, Due today, Open, Completed); the eight views ("I think it's
 * important to see next week as well"), calendar weeks Monday to Sunday; "A day" to look at any day, with the
 * day in the URL (?date=) -- the Calendar's squares link here; search; Edit / Reschedule / Cancel-with-a-reason;
 * and on a one-day view, the day's diary events first, "where you have to be".
 *
 * Who sees what, Raptor's rule: an Administrator sees everybody's; everyone else sees their own, with Team Tasks
 * as the window onto the rest. Read Only people see, and change nothing.
 *
 * Stripped from Raptor: meetings from a synced calendar, tickets, "Prepare", the auto-rollover badge (Remus has
 * none of those). Remus's diary events take the meetings' place.
 */
export function TasksPage() {
  const { currentUser } = useAuth()
  const access = useAccess()
  const me = currentUser?.id
  const canEdit = access !== 'read_only'
  const today = localDay(new Date())
  const [params, setParams] = useSearchParams()
  const view = (TASK_VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as TaskView) : 'My Tasks'
  const dateFilter = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date') : null
  const [search, setSearch] = useState('')
  const [pickDay, setPickDay] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [cancelling, setCancelling] = useState<Task | null>(null)
  const [moving, setMoving] = useState<Task | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // The top bar's "+ Add -> Task" lands here with ?new=1 (Remus's pattern: one form per thing).
  useEffect(() => {
    if (params.get('new') !== '1') return
    setAdding(true)
    setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n }, { replace: true })
  }, [params, setParams])

  const { data, error, loading, reload, setData: set } = useLoad(async () => {
    const from = new Date(`${shiftDay(today, -42)}T00:00:00`).toISOString()
    const to = new Date(`${shiftDay(today, 90)}T00:00:00`).toISOString()
    const [tasks, team, events] = await Promise.all([listTasks(), listProfiles(), listEventsBetween(from, to).catch(() => [])])
    return { tasks, team, events }
  }, [], 'tasks')

  const tasks = useMemo(() => data?.tasks ?? [], [data])
  const scopeToSelf = access !== 'admin' && access !== 'read_only'
  const scoped = useMemo(() => (scopeToSelf ? tasks.filter((t) => t.owner_id === me) : tasks), [tasks, scopeToSelf, me])

  const filtered = useMemo(() => {
    let list = dateFilter
      ? scoped.filter((t) => t.status !== 'Cancelled' && localDay(new Date(t.due_date)) === dateFilter).sort((a, b) => a.due_date.localeCompare(b.due_date))
      : tasksInView(tasks, scoped, view, me, today)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.related_to_label ?? '').toLowerCase().includes(q) || (t.notes ?? '').toLowerCase().includes(q))
    }
    return list
  }, [tasks, scoped, view, dateFilter, search, me, today])

  const dayShown = dateFilter ?? (view === 'Today' ? today : view === 'Tomorrow' ? shiftDay(today, 1) : null)
  const myEvents = useMemo(() => (data?.events ?? []).filter((e) => !e.owner_id || e.owner_id === me), [data, me])
  const dayEvents = dayShown ? myEvents.filter((e) => localDay(new Date(e.start_at)) === dayShown) : []
  const counts = useMemo(() => dayCounts({ events: myEvents, tasks: tasks.filter((t) => t.owner_id === me) }), [myEvents, tasks, me])
  const figures = taskFigures(scoped, today)

  const go = (next: Record<string, string | null>) => setParams((p) => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(next)) if (v === null) n.delete(k); else n.set(k, v)
    return n
  })

  async function toggle(t: Task, done: boolean) {
    setActionError(null)
    const before = data
    // Ticked at once on the screen (Raptor's store is optimistic too), put back if the database says no.
    set((d) => d && { ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, status: done ? 'Completed' : 'Not Started' } : x)) })
    try { await setTaskDone(t, done, me ?? t.owner_id) } catch (e) { set(before); setActionError(e instanceof Error ? e.message : String(e)) }
  }

  if (loading && !data) return <Spinner page />

  return (
    <div className="space-y-4" data-testid="tasks-page">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Overdue', value: figures.overdue, tone: figures.overdue ? 'text-red-700' : 'text-slate-800', go: { view: 'Overdue', date: null } },
          { label: 'Due today', value: figures.dueToday, tone: 'text-slate-800', go: { view: 'Today', date: null } },
          { label: 'Open tasks', value: figures.open, tone: 'text-slate-800', go: { view: 'My Tasks', date: null } },
          { label: 'Completed', value: figures.completed, tone: 'text-emerald-700', go: { view: 'Completed', date: null } },
        ].map((f) => (
          <button key={f.label} type="button" onClick={() => go(f.go)} className="card px-4 py-3 text-left hover:border-slate-300" data-testid={`task-figure-${f.label.toLowerCase().replace(/\s+/g, '-')}`}>
            <p className="text-xs text-slate-400">{f.label}</p>
            <p className={clsx('mt-1 text-xl font-bold tabular-nums', f.tone)}>{f.value}</p>
          </button>
        ))}
      </div>

      {dateFilter ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => setPickDay((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <CalendarDays size={13} /> Another day
          </button>
          <h2 className="text-sm font-semibold text-slate-700" data-testid="task-day-heading">{formatDate(dateFilter, 'EEEE d MMMM yyyy')}</h2>
          <span className="text-xs text-slate-400">{dayCountSentence(counts.get(dateFilter) ?? { events: 0, tasks: 0, total: 0 })}</span>
          <button type="button" onClick={() => go({ date: null })} className="text-xs font-medium text-brand-700 hover:underline">Clear date filter</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2" role="tablist">
          {TASK_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => go({ view: v, date: null })}
              aria-pressed={view === v}
              className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium', view === v ? 'bg-brand-500 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
            >
              {v}
            </button>
          ))}
          <button type="button" onClick={() => setPickDay((v) => !v)} className={clsx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium', pickDay ? 'bg-ink-950 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
            <CalendarDays size={14} /> A day
          </button>
        </div>
      )}

      {pickDay && (
        <Card>
          <TaskDayPicker value={dateFilter ?? ''} onChange={(day) => { go({ date: day }); setPickDay(false) }} counts={counts} today={today} allowPast />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:w-64">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks..." className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </div>
        <span className="text-xs text-slate-400">{filtered.length === 1 ? '1 task' : `${filtered.length} tasks`}</span>
        {canEdit && <Button variant="primary" className="ml-auto" onClick={() => setAdding(true)} data-testid="task-add"><Plus size={15} /> Add task</Button>}
      </div>

      <ErrorBanner error={actionError ?? error} />

      {/* THE DAY'S DIARY FIRST, "where you have to be" (Raptor's meetings card), only on a one-day view and only
          when there is something: "a card headed Meetings over a line saying none is a row of furniture". */}
      {dayEvents.length > 0 && (
        <Card padded={false}>
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2.5">
            <CalendarClock size={14} className="text-brand-700" />
            <span className="text-xs font-medium text-slate-500">{dayEvents.length === 1 ? 'Diary event' : 'Diary events'} — where you have to be</span>
          </div>
          {dayEvents.map((e) => (
            <div key={e.id} className="flex items-center gap-3 border-b border-slate-50 px-3 py-1.5 text-[12.5px] last:border-0">
              <span className="w-14 shrink-0 font-semibold text-slate-600 tabular-nums">{e.all_day ? 'All day' : formatDate(e.start_at, 'HH:mm')}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{e.title}{e.location && <span className="font-normal text-slate-400"> · {e.location}</span>}</span>
              <Link to={paths.calendar()} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Calendar</Link>
            </div>
          ))}
        </Card>
      )}

      <Card padded={false}>
        <TaskList
          tasks={filtered}
          team={data?.team ?? []}
          today={today}
          dayShown={dayShown}
          canEdit={canEdit}
          onToggle={toggle}
          onEdit={setEditing}
          onReschedule={setMoving}
          onCancel={setCancelling}
        />
      </Card>

      <TaskFormModal
        open={adding || !!editing}
        editing={editing}
        defaults={dateFilter ? { day: dateFilter } : undefined}
        onClose={() => { setAdding(false); setEditing(null) }}
        onSaved={() => { setAdding(false); setEditing(null); reload() }}
      />
      <CancelTaskModal task={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); reload() }} />
      <RescheduleTaskModal task={moving} onClose={() => setMoving(null)} onDone={() => { setMoving(null); reload() }} />
    </div>
  )
}
