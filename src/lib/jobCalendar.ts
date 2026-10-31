/**
 * THE JOBS CALENDAR (Remus · Handover 6). Stephan: "we have four jobs booked for next month ... and then we
 * don't have any work for December yet, or January ... and then in February there's a booked job. So I want
 * to see that ... not to overbook ourselves ... you should be able to set that somewhere. How many jobs can
 * you do at a certain time."
 *
 * Week by week: which jobs run, how many against the company's capacity (Settings → Company, max_jobs), and
 * the stretches ahead with nothing booked. PURE, so the counting is tested without a screen.
 */
import { addDays, format, parseISO, startOfWeek } from 'date-fns'

export interface CalendarJob {
  id: string
  name: string
  code: string | null
  status: string
  start_date: string | null
  end_date: string | null
}

export type WeekLoad = 'open' | 'room' | 'full' | 'over'

export interface CalendarWeek {
  /** Monday, yyyy-MM-dd. */
  start: string
  /** Friday, yyyy-MM-dd. */
  end: string
  jobs: CalendarJob[]
  load: WeekLoad
}

/** Jobs that take up a crew: not leads, not cancelled, and with dates. */
export function scheduledJobs<T extends CalendarJob>(jobs: T[]): T[] {
  return jobs.filter((j) => j.start_date && j.end_date && j.status !== 'lead' && j.status !== 'cancelled')
}

export function mondayOf(day: string): string {
  return format(startOfWeek(parseISO(day), { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

export function loadOf(n: number, capacity: number): WeekLoad {
  return n === 0 ? 'open' : n < capacity ? 'room' : n === capacity ? 'full' : 'over'
}

/** `count` weeks from the Monday of `from`, each with the jobs running in it (Monday to Friday). */
export function calendarWeeks<T extends CalendarJob>(jobs: T[], from: string, count: number, capacity: number): (CalendarWeek & { jobs: T[] })[] {
  const live = scheduledJobs(jobs)
  const first = parseISO(mondayOf(from))
  return Array.from({ length: count }, (_, i) => {
    const mon = addDays(first, i * 7)
    const start = format(mon, 'yyyy-MM-dd')
    const end = format(addDays(mon, 4), 'yyyy-MM-dd')
    const running = live.filter((j) => j.start_date! <= end && j.end_date! >= start)
    return { start, end, jobs: running, load: loadOf(running.length, capacity) }
  })
}

/** Stretches of weeks from `today` on with no job at all: "nothing booked from 14 Dec to 29 Jan". */
export function openStretches(weeks: CalendarWeek[], today: string): { from: string; to: string; weeks: number }[] {
  const out: { from: string; to: string; weeks: number }[] = []
  let run: CalendarWeek[] = []
  const flush = () => { if (run.length) out.push({ from: run[0].start, to: run[run.length - 1].end, weeks: run.length }); run = [] }
  for (const w of weeks) {
    if (w.end < today) continue
    if (w.load === 'open') run.push(w)
    else flush()
  }
  flush()
  return out
}

/** Weeks ahead with more jobs than the company can run. */
export function overbooked(weeks: CalendarWeek[], today: string): CalendarWeek[] {
  return weeks.filter((w) => w.end >= today && w.load === 'over')
}
