/**
 * ONE CALENDAR, FIVE KINDS OF THING ON IT (Remus · Handover 8).
 *
 * Raptor's CalendarPage puts tasks, deal close dates and meetings in one list of events, each kind in its own
 * colour. Remus's equivalents: tasks with a due date, diary events (Remus's meetings and site visits), the job
 * stages and the crew booked onto them (the plan), and each project's start and finish. Built here, with no
 * fetching, so the page only draws and the rules are tested (calendarItems.test.ts).
 *
 * DIFFERENT FROM RAPTOR: Raptor's events are all one day long. A stage or a crew booking runs for days, so an item
 * has a start and an end. The month grid shows a run on the day it starts and the day it ends (a month of every
 * running stage on every square is a wall of chips); the week and day views show it on every day it runs.
 */
import { isOpen, localDay, taskTime, type Task } from './tasks'
import type { DiaryEvent, ID, Project, ProjectStage, StageBooking, Worker } from '../types'

export type CalKind = 'task' | 'diary' | 'stage' | 'crew' | 'project'

export const CAL_KINDS: { id: CalKind; label: string }[] = [
  { id: 'task', label: 'Tasks' },
  { id: 'diary', label: 'Diary' },
  { id: 'stage', label: 'Job stages' },
  { id: 'crew', label: 'Crew bookings' },
  { id: 'project', label: 'Project start & end' },
]

export interface CalItem {
  id: string
  kind: CalKind
  /** The first thing read on the chip: what or who it is about. */
  title: string
  /** The second: the job, the stage, the type. */
  sub?: string
  /** 'YYYY-MM-DD', inclusive both ends. A one-day item has start === end. */
  start: string
  end: string
  /** 'HH:mm', where the thing has an hour. */
  time: string | null
  ownerId: ID | null
  projectId: ID | null
  /** A finished task, drawn struck through. */
  done?: boolean
  /** The diary event itself, which the calendar opens in place (Raptor opens a meeting rather than navigating). */
  diary?: DiaryEvent
}

export function buildCalendar(input: {
  tasks: Task[]
  events: DiaryEvent[]
  stages: ProjectStage[]
  bookings: StageBooking[]
  workers: Worker[]
  projects: Project[]
}): CalItem[] {
  const projectName = new Map(input.projects.map((p) => [p.id, p.name]))
  const stageById = new Map(input.stages.map((s) => [s.id, s]))
  const workerName = new Map(input.workers.map((w) => [w.id, w.name]))
  const out: CalItem[] = []

  for (const t of input.tasks) {
    if (t.status === 'Cancelled') continue
    const day = localDay(new Date(t.due_date))
    out.push({
      id: `t-${t.id}`, kind: 'task', title: t.title,
      sub: [t.type, t.related_to_label].filter(Boolean).join(' · '),
      start: day, end: day, time: taskTime(t), ownerId: t.owner_id, projectId: t.project_id, done: !isOpen(t),
    })
  }

  for (const e of input.events) {
    const s = new Date(e.start_at)
    const end = e.end_at ? new Date(e.end_at) : s
    const startDay = localDay(s)
    const endDay = localDay(end) < startDay ? startDay : localDay(end)
    out.push({
      id: `d-${e.id}`, kind: 'diary', title: e.title,
      sub: [e.project_id ? projectName.get(e.project_id) : null, e.location].filter(Boolean).join(' · ') || undefined,
      start: startDay, end: endDay, time: e.all_day ? null : localTime(s), ownerId: e.owner_id, projectId: e.project_id, diary: e,
    })
  }

  for (const st of input.stages) {
    if (!st.start_date) continue
    out.push({
      id: `s-${st.id}`, kind: 'stage', title: st.name || 'Stage',
      sub: projectName.get(st.project_id), start: st.start_date, end: st.end_date ?? st.start_date,
      time: null, ownerId: null, projectId: st.project_id,
    })
  }

  for (const b of input.bookings) {
    const st = stageById.get(b.stage_id)
    if (!st) continue
    out.push({
      id: `c-${b.id}`, kind: 'crew', title: workerName.get(b.worker_id) ?? 'Crew',
      sub: [st.name, projectName.get(st.project_id)].filter(Boolean).join(' · '),
      start: b.start_date, end: b.end_date, time: null, ownerId: null, projectId: st.project_id,
    })
  }

  for (const p of input.projects) {
    if (p.start_date) out.push({ id: `ps-${p.id}`, kind: 'project', title: p.name, sub: 'Job starts', start: p.start_date, end: p.start_date, time: null, ownerId: null, projectId: p.id })
    if (p.end_date) out.push({ id: `pe-${p.id}`, kind: 'project', title: p.name, sub: 'Job finishes', start: p.end_date, end: p.end_date, time: null, ownerId: null, projectId: p.id })
  }
  return out
}

function localTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Where `day` falls in an item: its only day, its first, its last, or a day in between. */
export function edgeOf(item: CalItem, day: string): 'single' | 'starts' | 'ends' | 'during' | null {
  if (day < item.start || day > item.end) return null
  if (item.start === item.end) return 'single'
  if (day === item.start) return 'starts'
  if (day === item.end) return 'ends'
  return 'during'
}

/**
 * What a day shows. `month`: one-day things, and runs only where they start or end. Otherwise every day a run is
 * on. In time order: things with an hour first by the hour, then the rest by kind.
 */
export function itemsOn(items: CalItem[], day: string, mode: 'month' | 'all'): CalItem[] {
  const order: CalKind[] = ['project', 'diary', 'task', 'stage', 'crew']
  return items
    .filter((i) => {
      const e = edgeOf(i, day)
      return e !== null && (mode === 'all' || e !== 'during')
    })
    .sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time)
      if (a.time) return -1
      if (b.time) return 1
      return order.indexOf(a.kind) - order.indexOf(b.kind) || a.title.localeCompare(b.title)
    })
}

/** "Day 3 of 7" on a run, counted in calendar days. */
export function runDay(item: CalItem, day: string): string | null {
  if (item.start === item.end) return null
  const d = (s: string) => new Date(`${s}T12:00:00`).getTime()
  const n = Math.round((d(day) - d(item.start)) / 86_400_000) + 1
  const of = Math.round((d(item.end) - d(item.start)) / 86_400_000) + 1
  return `day ${n} of ${of}`
}
