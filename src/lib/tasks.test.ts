import { describe, expect, it } from 'vitest'
import { dayCounts, dueFrom, localDay, mondayOf, myTasksDue, shiftDay, taskActivity, taskFigures, taskTime, tasksInView, weekStrip, type Task } from './tasks'
import { buildCalendar, edgeOf, itemsOn, runDay } from './calendarItems'
import type { DiaryEvent, Project, ProjectStage, StageBooking, Worker } from '../types'

const ME = 'me'
const task = (over: Partial<Task>): Task => ({
  id: Math.random().toString(36).slice(2), title: 'Order cement', type: 'To do', status: 'Not Started', priority: 'Medium',
  owner_id: ME, due_date: dueFrom('2026-11-09', ''), project_id: null, company_id: null, contact_id: null,
  related_to_label: null, notes: null, created_by: ME, created_at: '2026-11-01T08:00:00Z',
  completed_at: null, cancelled_at: null, cancel_reason: null, ...over,
})

describe('days (Raptor dayPlan, Monday weeks)', () => {
  it('shifts by calendar days and finds the Monday', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01')
    expect(mondayOf('2026-11-08')).toBe('2026-11-02') // a Sunday belongs to the week before
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
    expect(weekStrip('2026-11-11', 2)).toHaveLength(14)
    expect(weekStrip('2026-11-11', 1)[0]).toBe('2026-11-09')
  })
  it('reads a blank time back as "any time"', () => {
    expect(taskTime(task({ due_date: dueFrom('2026-11-09', '') }))).toBeNull()
    expect(taskTime(task({ due_date: dueFrom('2026-11-09', '09:30') }))).toBe('09:30')
    expect(localDay(new Date(dueFrom('2026-11-09', '')))).toBe('2026-11-09')
  })
})

describe('the views', () => {
  const today = '2026-11-09'
  const all = [
    task({ title: 'late', due_date: dueFrom('2026-11-05', '') }),
    task({ title: 'today', due_date: dueFrom(today, '10:00') }),
    task({ title: 'tomorrow', due_date: dueFrom('2026-11-10', '') }),
    task({ title: 'next week', due_date: dueFrom('2026-11-17', '') }),
    task({ title: 'done', status: 'Completed', due_date: dueFrom('2026-11-06', '') }),
    task({ title: 'theirs', owner_id: 'them' }),
  ]
  const mine = all.filter((t) => t.owner_id === ME)
  const titles = (l: Task[]) => l.map((t) => t.title)
  it('splits the work the way Raptor does', () => {
    expect(titles(tasksInView(all, mine, 'Overdue', ME, today))).toEqual(['late'])
    expect(titles(tasksInView(all, mine, 'Today', ME, today))).toEqual(['today'])
    expect(titles(tasksInView(all, mine, 'Tomorrow', ME, today))).toEqual(['tomorrow'])
    expect(titles(tasksInView(all, mine, 'Next Week', ME, today))).toEqual(['next week'])
    expect(titles(tasksInView(all, mine, 'Completed', ME, today))).toEqual(['done'])
    expect(tasksInView(all, mine, 'Team Tasks', ME, today)).toHaveLength(5)
    expect(tasksInView(all, mine, 'My Tasks', ME, today)).toHaveLength(4)
  })
  it('counts the figures', () => {
    expect(taskFigures(mine, today)).toEqual({ overdue: 1, dueToday: 1, open: 4, completed: 1 })
  })
  it('badges only my open work due by tonight', () => {
    const now = new Date(dueFrom(today, '08:00'))
    expect(myTasksDue(all, ME, now)).toBe(2) // late + today; not tomorrow, not done, not theirs
  })
  it('counts a day\'s load apart', () => {
    const c = dayCounts({ events: [{ start_at: dueFrom(today, '09:00') }], tasks: mine })
    expect(c.get(today)).toEqual({ events: 1, tasks: 1, total: 2 })
  })
  it('writes the reason on the file when a task is called off', () => {
    const a = taskActivity(task({ company_id: 'c1' }), 'cancelled', ME, 'Client moved it')
    expect(a.subject).toBe('Task cancelled: Order cement')
    expect(a.notes).toBe('Why: Client moved it')
    expect(a.company_id).toBe('c1')
  })
})

describe('the calendar', () => {
  const project = { id: 'p1', name: 'Kitchen', start_date: '2026-11-02', end_date: '2026-11-30' } as Project
  const stage = { id: 's1', project_id: 'p1', name: 'Plumbing', start_date: '2026-11-09', end_date: '2026-11-13' } as ProjectStage
  const booking = { id: 'b1', stage_id: 's1', worker_id: 'w1', start_date: '2026-11-10', end_date: '2026-11-11' } as StageBooking
  const worker = { id: 'w1', name: 'Sipho' } as Worker
  const event = { id: 'e1', title: 'Site visit', start_at: dueFrom('2026-11-11', '09:00'), end_at: null, all_day: false, project_id: 'p1', location: null, owner_id: ME } as DiaryEvent
  const items = buildCalendar({
    tasks: [task({ due_date: dueFrom('2026-11-11', '') }), task({ status: 'Cancelled' })],
    events: [event], stages: [stage], bookings: [booking], workers: [worker], projects: [project],
  })
  it('puts every kind on it, cancelled tasks left off', () => {
    expect(items.map((i) => i.kind).sort()).toEqual(['crew', 'diary', 'project', 'project', 'stage', 'task'])
  })
  it('shows a run only at its ends on the month, every day on the week', () => {
    const plumbing = items.find((i) => i.kind === 'stage')!
    expect(edgeOf(plumbing, '2026-11-09')).toBe('starts')
    expect(edgeOf(plumbing, '2026-11-11')).toBe('during')
    expect(itemsOn(items, '2026-11-11', 'month').map((i) => i.kind)).toEqual(['diary', 'task', 'crew'])
    expect(itemsOn(items, '2026-11-11', 'all').map((i) => i.kind)).toEqual(['diary', 'task', 'stage', 'crew'])
    expect(runDay(plumbing, '2026-11-11')).toBe('day 3 of 5')
  })
  it('names the crew by person and stage', () => {
    const crew = items.find((i) => i.kind === 'crew')!
    expect(crew.title).toBe('Sipho')
    expect(crew.sub).toBe('Plumbing · Kitchen')
  })
})
