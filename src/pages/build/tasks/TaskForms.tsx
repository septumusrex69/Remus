import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { listEventsBetween, listProfiles, loadClientDirectory, projects as projectsApi } from '../../../lib/api'
import { addTask, cancelTask, listTasks, updateTask } from '../../../lib/tasksApi'
import {
  NO_DAY_COUNT, TASK_PRIORITIES, TASK_TYPES, dayCountSentence, dayCounts, dueFrom, localDay, shiftDay, taskTime,
  weekStrip, type DayCount, type Task, type TaskPriority,
} from '../../../lib/tasks'
import { publicHolidays } from '../../../lib/workdays'
import { formatDate } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { useAuth } from '../../../store/AuthContext'
import { Button, ErrorBanner, Field, Modal } from '../../../components/ui'
import { ClientPicker } from '../components/ClientPicker'
import type { ClientRef, ID } from '../../../types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * CHOOSING A DAY FOR A TASK, WITH THE DAY'S LOAD ALREADY ON IT -- Raptor's `components/tasks/TaskDayPicker.tsx`.
 *
 * Raptor's firm: "it asks you when, but it should look like a rediarisation almost thing, to show you how many
 * meetings do you have for a specific day." Three weeks, Monday first, with two little numbers under each day:
 * diary events (Remus's meetings and site visits) and tasks. A weekend or public holiday is tinted and named, and
 * still choosable. It counts and does not judge: no "full", no red. `allowPast` is for looking back (the Tasks
 * page's "A day"), never for booking.
 */
export function TaskDayPicker({ value, onChange, counts, today, weeks = 3, allowPast = false, note }: {
  value: string
  onChange: (day: string) => void
  counts: Map<string, DayCount>
  today: string
  weeks?: number
  allowPast?: boolean
  note?: string
}) {
  const [from, setFrom] = useState(() => weekStrip(value || today, 1)[0])
  const days = useMemo(() => weekStrip(from, weeks), [from, weeks])
  const holidays = useMemo(() => {
    const out = new Set<string>()
    for (const y of new Set(days.map((d) => Number(d.slice(0, 4))))) for (const h of publicHolidays(y)) out.add(h)
    return out
  }, [days])
  const span = `${formatDate(days[0], 'd MMM')} – ${formatDate(days[days.length - 1], 'd MMM yyyy')}`
  const chosen = counts.get(value) ?? NO_DAY_COUNT

  return (
    <div className="max-w-[32rem]" data-testid="task-day-picker">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setFrom(shiftDay(from, -7 * weeks))} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Earlier weeks" aria-label="Earlier weeks">
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs font-medium text-slate-500">{span}</span>
        <button type="button" onClick={() => setFrom(shiftDay(from, 7 * weeks))} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Later weeks" aria-label="Later weeks">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="text-[10px] font-medium text-slate-400">{d}</span>)}
        {days.map((day) => {
          const c = counts.get(day) ?? NO_DAY_COUNT
          const wd = new Date(`${day}T12:00:00`).getDay()
          const closed = holidays.has(day) || wd === 0 || wd === 6
          const past = day < today
          const disabled = past && !allowPast
          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => onChange(day)}
              title={[formatDate(day, 'EEEE d MMMM'), holidays.has(day) ? 'Public holiday' : closed ? 'Weekend' : null, disabled ? 'Already gone' : dayCountSentence(c)].filter(Boolean).join(' — ')}
              className={clsx(
                'flex min-h-11 flex-col items-center justify-center rounded-lg border px-0.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                value === day ? 'border-brand-500 bg-brand-500 text-white' : closed ? 'border-slate-200 bg-slate-100 text-slate-500 hover:border-slate-300' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                day === today && value !== day && 'ring-1 ring-brand-300',
              )}
            >
              <span className="font-semibold tabular-nums">{Number(day.slice(8))}</span>
              <span className={clsx('text-[10px] tabular-nums', value === day ? 'text-white/85' : 'text-slate-400')}>
                {c.total === 0 ? '–' : (
                  <>
                    {c.events > 0 && <span className={value === day ? '' : 'text-brand-700'}>{c.events}</span>}
                    {c.events > 0 && c.tasks > 0 && '/'}
                    {c.tasks > 0 && <span>{c.tasks}</span>}
                  </>
                )}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-brand-600" /> diary events</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> tasks</span>
      </p>
      {value && (
        <p className="mt-2 text-sm text-slate-700">
          <span className="font-medium">{formatDate(value, 'EEEE d MMMM')}</span>
          <span className="text-slate-400"> · {dayCountSentence(chosen)}</span>
        </p>
      )}
      {note && <p className="mt-1 text-[11px] text-slate-400">{note}</p>}
    </div>
  )
}

/** What a new task starts with when it is raised from a record (a project's or a client's Tasks tab). */
export type TaskDefaults = Partial<Pick<Task, 'project_id' | 'company_id' | 'contact_id' | 'related_to_label' | 'title' | 'owner_id'>> & { day?: string }

/**
 * ADDING A TASK AND EDITING ONE ARE THE SAME BOX (Raptor's TaskModal): "two would drift". Title, type, priority,
 * the day (with the day's load on it), an optional time ("leave it blank for any time that day"), whose it is, and
 * what it is about -- a job and/or a client, so it lands on their pages. Giving it to somebody else rings their bell
 * (migration 0043).
 *
 * It loads what it needs itself (the team, the jobs, the clients, the owner's next weeks), so any page can open it.
 */
export function TaskFormModal({ open, editing, defaults, onClose, onSaved }: {
  open: boolean
  editing?: Task | null
  defaults?: TaskDefaults
  onClose: () => void
  onSaved: (t: Task) => void
}) {
  const { currentUser } = useAuth()
  const me = currentUser?.id ?? ''
  const today = localDay(new Date())
  const { data } = useLoad(async () => {
    if (!open) return null
    const from = new Date(`${shiftDay(today, -7)}T00:00:00`).toISOString()
    const to = new Date(`${shiftDay(today, 63)}T00:00:00`).toISOString()
    const [team, projects, dir, tasks, events] = await Promise.all([
      listProfiles(), projectsApi.list(), loadClientDirectory(), listTasks().catch(() => [] as Task[]), listEventsBetween(from, to).catch(() => []),
    ])
    return { team: team.filter((p) => p.status === 'Active' && p.role !== 'Read Only'), projects, dir, tasks, events }
  }, [open], 'task-form')

  const blank = () => ({
    title: defaults?.title ?? '', type: 'To do', priority: 'Medium' as TaskPriority, owner: defaults?.owner_id ?? me,
    day: defaults?.day ?? '', time: '', notes: '', project: defaults?.project_id ?? null,
    client: { company_id: defaults?.company_id ?? null, contact_id: defaults?.contact_id ?? null } as ClientRef,
  })
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (editing) {
      setForm({
        title: editing.title, type: editing.type, priority: editing.priority, owner: editing.owner_id,
        day: localDay(new Date(editing.due_date)), time: taskTime(editing) ?? '', notes: editing.notes ?? '',
        project: editing.project_id, client: { company_id: editing.company_id, contact_id: editing.contact_id },
      })
    } else setForm(blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  /* The owner's day, recounted when the owner changes ("the question is about THEIR day"). Diary events are
     counted for the person they are assigned to. */
  const counts = useMemo(() => dayCounts({
    events: (data?.events ?? []).filter((e) => e.owner_id === form.owner),
    tasks: (data?.tasks ?? []).filter((t) => t.owner_id === form.owner && t.id !== editing?.id),
  }), [data, form.owner, editing])

  const projectName = (id: ID | null) => data?.projects.find((p) => p.id === id)?.name ?? null
  const clientName = (c: ClientRef) => {
    if (c.company_id) return data?.dir.companyById.get(c.company_id)?.name ?? null
    const ct = c.contact_id ? data?.dir.contactById.get(c.contact_id) : null
    return ct ? `${ct.first_name} ${ct.last_name}`.trim() : null
  }

  async function save() {
    if (!form.title.trim()) return setError('Give the task a title.')
    if (!form.day) return setError('Choose the day it is due.')
    setSaving(true)
    setError(null)
    try {
      const label = [projectName(form.project), clientName(form.client)].filter(Boolean).join(' · ') || defaults?.related_to_label || null
      const values = {
        title: form.title.trim(), type: form.type, priority: form.priority, owner_id: form.owner || me,
        due_date: dueFrom(form.day, form.time), notes: form.notes.trim() || null,
        project_id: form.project, company_id: form.client.company_id, contact_id: form.client.contact_id,
        related_to_label: label,
      }
      const saved = editing ? await updateTask(editing.id, values) : await addTask(values)
      onSaved(saved)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const mine = form.owner === me
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit task' : 'Add task'}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={save} data-testid="task-save">{editing ? 'Save changes' : 'Add task'}</Button>
      </>}
    >
      <div className="space-y-3" data-testid="task-form">
        <ErrorBanner error={error} />
        <Field label="Task">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Order the cement for Monday" autoFocus data-testid="task-title" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {[...new Set([...TASK_TYPES, form.type])].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
              {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <div>
          <span className="label">Day</span>
          <TaskDayPicker
            value={form.day}
            onChange={(day) => setForm({ ...form, day })}
            counts={counts}
            today={today}
            note={mine ? undefined : 'Counting their tasks and the diary events given to them.'}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Whose task">
            <select className="input" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} data-testid="task-owner">
              {!data?.team.some((p) => p.id === form.owner) && form.owner && <option value={form.owner}>{form.owner === me ? (currentUser?.name || 'Me') : 'Somebody'}</option>}
              {(data?.team ?? []).map((p) => <option key={p.id} value={p.id}>{p.id === me ? `${p.name || p.email} (me)` : p.name || p.email}</option>)}
            </select>
          </Field>
          <Field label="Time" hint="Optional — leave it blank for any time that day.">
            <input type="time" className="input" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </Field>
        </div>
        <Field label="Job" hint="Optional. The task shows on the job's page.">
          <select
            className="input"
            value={form.project ?? ''}
            onChange={(e) => {
              const id = e.target.value || null
              const p = data?.projects.find((x) => x.id === id)
              // A job's client comes with it, unless one was already chosen.
              const client = p && !form.client.company_id && !form.client.contact_id ? { company_id: p.company_id, contact_id: p.contact_id } : form.client
              setForm({ ...form, project: id, client })
            }}
          >
            <option value="">Not about a job</option>
            {(data?.projects ?? []).filter((p) => p.status !== 'cancelled' || p.id === form.project).map((p) => (
              <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>
            ))}
          </select>
        </Field>
        <div>
          <span className="label">Client</span>
          <ClientPicker dir={data?.dir ?? null} value={form.client} onChange={(client) => setForm({ ...form, client })} />
          <span className="mt-1 block text-xs text-slate-500">Optional. Finishing it or calling it off goes onto their file.</span>
        </div>
        <Field label="Notes">
          <textarea className="input min-h-16" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

/**
 * CALLING A TASK OFF, AND SAYING WHY (Raptor's CancelTaskModal). "The reason is asked for and not required. A
 * required one is a box everybody fills with a full stop." Nothing is deleted: it stays on the record.
 */
export function CancelTaskModal({ task, onClose, onDone }: { task: Task | null; onClose: () => void; onDone: () => void }) {
  const { currentUser } = useAuth()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setReason(''); setError(null) }, [task])
  if (!task) return null
  const onFile = task.company_id || task.contact_id || task.project_id
  return (
    <Modal
      open
      onClose={onClose}
      title="Cancel this task?"
      footer={<>
        <Button onClick={onClose}>Keep it</Button>
        <Button variant="danger" loading={saving} onClick={async () => {
          setSaving(true)
          try { await cancelTask(task, reason.trim(), currentUser?.id ?? task.owner_id); onDone() } catch (e) { setError(errMsg(e)) } finally { setSaving(false) }
        }}>Cancel the task</Button>
      </>}
    >
      <ErrorBanner error={error} />
      <p className="text-sm text-slate-500"><span className="font-medium text-slate-700">{task.title}</span>{task.related_to_label && <> · {task.related_to_label}</>}</p>
      <p className="mt-2 text-[13px] text-slate-500">It comes off the working lists and stays on the record.{onFile && ' This goes onto the client’s and job’s file.'}</p>
      <Field label="Why?" className="mt-3" hint="Optional — but it is the half somebody reading this in six months actually needs.">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The client moved it to next month" autoFocus />
      </Field>
    </Modal>
  )
}

/** Moving a date: its own button, "the thing that happens fifty times a day" (Raptor's RescheduleTaskModal). */
export function RescheduleTaskModal({ task, onClose, onDone }: { task: Task | null; onClose: () => void; onDone: () => void }) {
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!task) return
    setDay(localDay(new Date(task.due_date)))
    setTime(taskTime(task) ?? '')
    setError(null)
  }, [task])
  if (!task) return null
  return (
    <Modal
      open
      onClose={onClose}
      title="Reschedule task"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={async () => {
          if (!day) return
          setSaving(true)
          try { await updateTask(task.id, { due_date: dueFrom(day, time) }); onDone() } catch (e) { setError(errMsg(e)) } finally { setSaving(false) }
        }}>Save</Button>
      </>}
    >
      <ErrorBanner error={error} />
      <p className="mb-3 text-sm text-slate-600">{task.title}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="New day"><input type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label="Time"><input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}
