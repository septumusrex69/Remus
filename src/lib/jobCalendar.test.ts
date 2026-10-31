import { describe, expect, it } from 'vitest'
import { calendarWeeks, loadOf, openStretches, overbooked, type CalendarJob } from './jobCalendar'

const job = (id: string, start: string, end: string, status = 'active'): CalendarJob => ({ id, name: id, code: null, status, start_date: start, end_date: end })

describe('jobs calendar', () => {
  it('counts the jobs running each week against the capacity', () => {
    const jobs = [job('a', '2026-11-02', '2026-11-20'), job('b', '2026-11-09', '2026-11-13'), job('c', '2026-11-12', '2026-12-04', 'planned'),
      job('lead', '2026-11-02', '2026-11-30', 'lead'), job('gone', '2026-11-02', '2026-11-30', 'cancelled'), { ...job('undated', '', ''), start_date: null }]
    const w = calendarWeeks(jobs, '2026-11-04', 6, 2)
    expect(w.map((x) => x.start)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07'])
    expect(w.map((x) => x.jobs.length)).toEqual([1, 3, 2, 1, 1, 0])
    expect(w.map((x) => x.load)).toEqual(['room', 'over', 'full', 'room', 'room', 'open'])
  })
  it('loads', () => {
    expect([loadOf(0, 4), loadOf(3, 4), loadOf(4, 4), loadOf(5, 4)]).toEqual(['open', 'room', 'full', 'over'])
  })
  it('finds the open stretches ahead and the overbooked weeks', () => {
    const jobs = [job('a', '2026-11-02', '2026-12-11'), job('b', '2026-11-02', '2026-11-13'), job('feb', '2027-02-01', '2027-03-26', 'planned')]
    const w = calendarWeeks(jobs, '2026-11-02', 18, 1)
    expect(openStretches(w, '2026-11-02')).toEqual([{ from: '2026-12-14', to: '2027-01-29', weeks: 7 }])
    expect(overbooked(w, '2026-11-02').map((x) => x.start)).toEqual(['2026-11-02', '2026-11-09'])
    // Past weeks are not "open ahead".
    expect(openStretches(w, '2027-02-01')).toEqual([])
  })
})
