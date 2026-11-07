/** Ported from Raptor's lib/emailActivity.ts and lib/dateLabels.ts. */

export interface ParsedEmailActivity {
  direction: 'sent' | 'received'
  isSpam: boolean
  /** The email's own subject line, with the "Email sent:"/"Email received:" framing stripped off. */
  subject: string
}

const PREFIXES: { prefix: string; direction: ParsedEmailActivity['direction']; isSpam: boolean }[] = [
  { prefix: 'Email received (was in Spam/Junk): ', direction: 'received', isSpam: true },
  { prefix: 'Email received: ', direction: 'received', isSpam: false },
  { prefix: 'Email sent: ', direction: 'sent', isSpam: false },
]

/** Parses an activity's stored subject (see api/email/send.ts and api/_lib/emailSync.ts) back into direction + the real subject. */
export function parseEmailActivity(rawSubject: string): ParsedEmailActivity | null {
  for (const { prefix, direction, isSpam } of PREFIXES) {
    if (rawSubject.startsWith(prefix)) return { direction, isSpam, subject: rawSubject.slice(prefix.length) }
  }
  return null
}

/**
 * The heading a run of emails sits under, so each row only needs a time. Recent days read by
 * name ("Yesterday"), then always with a date ("Thursday 5 Nov", "5 November"): never "Last week".
 */
export function emailDayLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000)
  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  /*
   * PAST YESTERDAY, ALWAYS A REAL DATE (Raptor S18, copied in Remus · Handover 8; Stephan on Raptor, 6 Nov, on an email:
   * "It says last week at 13:40. When was it received? There's no actual date"). "Last week" named no day at all. A
   * weekday keeps its name for the week just gone, because "Thursday" lands faster than a number, but the date rides
   * with it; beyond that it is the date. Months written out by hand: en-ZA renders September as "Sept".
   */
  const month = MONTHS[date.getMonth()]
  const sameYear = date.getFullYear() === new Date().getFullYear()
  if (dayDiff > 1 && dayDiff < 7) return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${month.slice(0, 3)}`
  return `${date.getDate()} ${month}${sameYear ? '' : ` ${date.getFullYear()}`}`
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Just the clock time; the day heading above the row carries the date. */
export function emailTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "Re: " once, never "Re: Re: Re: ". */
export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`
}
