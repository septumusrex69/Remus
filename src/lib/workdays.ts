/**
 * Working days in South Africa: Monday to Friday, less public holidays (Public Holidays Act: a
 * holiday on a Sunday moves to the Monday). A plan "2 working days, starting Friday" ends on the
 * Monday; one starting on 24 September (Heritage Day) starts on the 25th.
 *
 * Dates are 'YYYY-MM-DD' strings throughout, read as calendar days (no time zones involved).
 */

const pad = (n: number) => String(n).padStart(2, '0')
const ymdOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`)

/** Easter Sunday (Gregorian), by the anonymous algorithm. */
function easter(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

const cache = new Map<number, Set<string>>()

/** South Africa's public holidays for a year, with Sunday holidays moved to the Monday. */
export function publicHolidays(year: number): Set<string> {
  const hit = cache.get(year)
  if (hit) return hit
  const fixed = ['01-01', '03-21', '04-27', '05-01', '06-16', '08-09', '09-24', '12-16', '12-25', '12-26'].map((md) => `${year}-${md}`)
  const e = easter(year).getTime()
  const day = 86_400_000
  const days = [...fixed, ymdOf(new Date(e - 2 * day)), ymdOf(new Date(e + day))] // Good Friday, Family Day
  const out = new Set<string>(days)
  for (const d of days) {
    const dt = dateOf(d)
    if (dt.getUTCDay() === 0) {
      // Sunday: the Monday is off (and if that is already a holiday, as on 26 Dec after a Sunday
      // Christmas, the next free weekday).
      let next = new Date(dt.getTime() + day)
      while (out.has(ymdOf(next))) next = new Date(next.getTime() + day)
      out.add(ymdOf(next))
    }
  }
  cache.set(year, out)
  return out
}

export function isWorkingDay(ymd: string): boolean {
  const d = dateOf(ymd)
  const wd = d.getUTCDay()
  return wd !== 0 && wd !== 6 && !publicHolidays(d.getUTCFullYear()).has(ymd)
}

/** The day itself if it is a working day, else the next one. */
export function nextWorkingDay(ymd: string): string {
  let d = dateOf(ymd)
  while (!isWorkingDay(ymdOf(d))) d = new Date(d.getTime() + 86_400_000)
  return ymdOf(d)
}

/** `n` working days after a working day (0 = the day itself). */
export function addWorkingDays(ymd: string, n: number): string {
  let cur = nextWorkingDay(ymd)
  for (let i = 0; i < n; i += 1) cur = nextWorkingDay(ymdOf(new Date(dateOf(cur).getTime() + 86_400_000)))
  return cur
}

/** Working days from `from` to `to`, both included (0 if `to` is before `from`). */
export function workingDaysBetween(from: string, to: string): number {
  if (to < from) return 0
  let n = 0
  for (let d = dateOf(from); ymdOf(d) <= to; d = new Date(d.getTime() + 86_400_000)) if (isWorkingDay(ymdOf(d))) n += 1
  return n
}

/** Every working day from `from` to `to`, both included. */
export function workingDaysIn(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = dateOf(from); ymdOf(d) <= to; d = new Date(d.getTime() + 86_400_000)) if (isWorkingDay(ymdOf(d))) out.push(ymdOf(d))
  return out
}

/** Do two date ranges share a day? */
export function overlaps(a: { start_date: string; end_date: string }, b: { start_date: string; end_date: string }): boolean {
  return a.start_date <= b.end_date && b.start_date <= a.end_date
}
