/**
 * TASKS, CALENDAR AND ACTIVITIES: the rules, with no fetching (Remus · Handover 8).
 *
 * Stephan, 7 Nov 2026: "Tasks is a good idea ... Calendar as well. Activities, yeah."
 *
 * Copied from Raptor's `lib/dayPlan.ts` (localDay, taskTime, shiftDay, weekStrip, dayCounts) and the view filters
 * in its `pages/tasks/TasksPage.tsx`, so the Tasks page, the Calendar, the sidebar count and the record pages all
 * answer "what is on the 8th" the same way. Pure functions, so they are tested (tasks.test.ts).
 */
import type { ID } from '../types'

export const TASK_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
/**
 * Raptor's task types were a sales desk's (Proposal, Research). These are a building firm's: the things a site
 * manager or Stephan writes down to do.
 */
export const TASK_TYPES = ['To do', 'Call', 'Site visit', 'Order', 'Follow-up', 'Email', 'Meeting', 'Quote', 'Other'] as const

/** One row of `tasks` (migration 0043). */
export interface Task {
  id: ID
  title: string
  type: string
  status: TaskStatus
  priority: TaskPriority
  owner_id: ID
  /** A full timestamp; local midnight means "any time that day" (see taskTime). */
  due_date: string
  project_id: ID | null
  company_id: ID | null
  contact_id: ID | null
  related_to_label: string | null
  notes: string | null
  created_by: ID | null
  created_at: string
  completed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
}

/** One row of `activities` as the timeline reads it (0006 + 0044). */
export interface ActivityRow {
  id: ID
  type: string
  user_id: ID
  company_id: ID | null
  contact_id: ID | null
  project_id: ID | null
  task_id: ID | null
  subject: string
  notes: string | null
  activity_date: string
  created_at: string
  attachment_names: string[] | null
}

/**
 * What a person logs by hand (Raptor's "Log a call / note / meeting"). Email is not here: emails are filed by the
 * mailbox, and a Task row is written when a task is finished or called off.
 */
export const LOG_TYPES = ['Call', 'Note', 'Meeting', 'Site visit', 'WhatsApp'] as const
export type LogType = (typeof LOG_TYPES)[number]

export const isOpen = (t: Pick<Task, 'status'>) => t.status !== 'Completed' && t.status !== 'Cancelled'

/* ---------------------------------------------------------------- days ---- */

/** 'YYYY-MM-DD' on the person's own clock (never toISOString, which is UTC and lands on the wrong day at night). */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The day `n` days from `day` ('YYYY-MM-DD'), by the calendar rather than by 24-hour steps. */
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return localDay(d)
}

/** The Monday on or before `day`. Remus's weeks start on Monday, as the Diary's and SA calendars do. */
export function mondayOf(day: string): string {
  const wd = new Date(`${day}T12:00:00`).getDay()
  return shiftDay(day, wd === 0 ? -6 : 1 - wd)
}

/** `weeks` whole weeks of days, Monday first, starting with the week holding `day` (Raptor's weekStrip). */
export function weekStrip(day: string, weeks: number): string[] {
  const start = mondayOf(day)
  return Array.from({ length: weeks * 7 }, (_, i) => shiftDay(start, i))
}

/**
 * The hour a task was booked for, or null where nobody chose one (Raptor's taskTime). The form saves local
 * midnight when the time is left blank, so midnight is read back as "any time that day".
 */
export function taskTime(t: Pick<Task, 'due_date'>): string | null {
  const d = new Date(t.due_date)
  if (Number.isNaN(d.getTime())) return null
  if (d.getHours() === 0 && d.getMinutes() === 0) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The stored timestamp for a day and an optional 'HH:mm' (blank = local midnight = any time). */
export function dueFrom(day: string, time: string): string {
  return new Date(`${day}T${time || '00:00'}`).toISOString()
}

/** The ISO instant the person's today ends (for "due by tonight", the sidebar count). */
export function endOfToday(now = new Date()): string {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.toISOString()
}

/* ---------------------------------------------------------- the views ---- */

/** Raptor's views, word for word: "I think it's important to see next week as well." */
export const TASK_VIEWS = ['My Tasks', 'Team Tasks', 'Overdue', 'Today', 'Tomorrow', 'This Week', 'Next Week', 'Completed'] as const
export type TaskView = (typeof TASK_VIEWS)[number]

/**
 * The tasks a view shows, soonest first. `scoped` is what the person sees by default (their own, unless they are
 * an Administrator); Team Tasks is everybody's open work.
 */
export function tasksInView(all: Task[], scoped: Task[], view: TaskView, me: ID | undefined, today: string): Task[] {
  const day = (t: Task) => localDay(new Date(t.due_date))
  const thisWeek = new Set(weekStrip(today, 1))
  const nextWeek = new Set(weekStrip(shiftDay(today, 7), 1))
  let list: Task[]
  switch (view) {
    case 'My Tasks': list = all.filter((t) => t.owner_id === me && isOpen(t)); break
    case 'Team Tasks': list = all.filter(isOpen); break
    case 'Overdue': list = scoped.filter((t) => isOpen(t) && day(t) < today); break
    case 'Today': list = scoped.filter((t) => day(t) === today && t.status !== 'Cancelled'); break
    case 'Tomorrow': list = scoped.filter((t) => day(t) === shiftDay(today, 1) && t.status !== 'Cancelled'); break
    case 'This Week': list = scoped.filter((t) => thisWeek.has(day(t)) && t.status !== 'Cancelled'); break
    case 'Next Week': list = scoped.filter((t) => nextWeek.has(day(t)) && t.status !== 'Cancelled'); break
    case 'Completed': list = scoped.filter((t) => t.status === 'Completed' || t.status === 'Cancelled'); break
  }
  return [...list].sort((a, b) => a.due_date.localeCompare(b.due_date))
}

/** The four figures over the list (Raptor's cards). */
export function taskFigures(scoped: Task[], today: string) {
  const day = (t: Task) => localDay(new Date(t.due_date))
  return {
    overdue: scoped.filter((t) => isOpen(t) && day(t) < today).length,
    dueToday: scoped.filter((t) => isOpen(t) && day(t) === today).length,
    open: scoped.filter(isOpen).length,
    completed: scoped.filter((t) => t.status === 'Completed').length,
  }
}

/**
 * THE SIDEBAR COUNT (Raptor's nav_counts rule): mine, still open, and due by tonight -- overdue included. "Not
 * all my tasks, which would be a permanent number nobody could ever clear."
 */
export function myTasksDue(tasks: Task[], me: ID | undefined, now = new Date()): number {
  const end = endOfToday(now)
  return tasks.filter((t) => t.owner_id === me && isOpen(t) && new Date(t.due_date).toISOString() < end).length
}

/* ------------------------------------------------------- a day's load ---- */

export interface DayCount { events: number; tasks: number; total: number }
export const NO_DAY_COUNT: DayCount = { events: 0, tasks: 0, total: 0 }

/**
 * How full each day already is (Raptor's dayCounts): diary events and open tasks, counted apart, because "five
 * meetings and one task is a day that is gone; one meeting and five tasks is a day with room in it".
 */
export function dayCounts(input: { events: { start_at: string }[]; tasks: Task[] }): Map<string, DayCount> {
  const out = new Map<string, DayCount>()
  const bump = (day: string, key: 'events' | 'tasks') => {
    const c = out.get(day) ?? { ...NO_DAY_COUNT }
    c[key] += 1
    c.total += 1
    out.set(day, c)
  }
  for (const e of input.events) bump(localDay(new Date(e.start_at)), 'events')
  for (const t of input.tasks) if (isOpen(t)) bump(localDay(new Date(t.due_date)), 'tasks')
  return out
}

export function dayCountSentence(c: DayCount): string {
  if (c.total === 0) return 'Nothing booked yet'
  const parts: string[] = []
  if (c.events) parts.push(`${c.events} diary event${c.events === 1 ? '' : 's'}`)
  if (c.tasks) parts.push(`${c.tasks} task${c.tasks === 1 ? '' : 's'}`)
  return parts.join(' and ')
}

/* ------------------------------------------------- the activity rows ---- */

/** The row written on the client's file when a task is finished or called off (Raptor's AppStore does this). */
export function taskActivity(t: Task, what: 'completed' | 'cancelled', userId: ID, reason?: string) {
  return {
    type: 'Task',
    user_id: userId,
    company_id: t.company_id,
    contact_id: t.contact_id,
    project_id: t.project_id,
    task_id: t.id,
    subject: `${t.type === 'To do' ? 'Task' : t.type} ${what}: ${t.title}`,
    notes: what === 'cancelled' && reason ? `Why: ${reason}` : null,
    activity_date: new Date().toISOString(),
  }
}
