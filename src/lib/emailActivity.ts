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
 * name ("Yesterday"); past a fortnight an exact date is easier to place than "37 days ago".
 */
export function emailDayLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000)
  if (dayDiff === 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff > 1 && dayDiff < 7) return date.toLocaleDateString('en-ZA', { weekday: 'long' })
  if (dayDiff >= 7 && dayDiff < 14) return 'Last week'
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: sameYear ? undefined : 'numeric' })
}

/** Just the clock time; the day heading above the row carries the date. */
export function emailTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "Re: " once, never "Re: Re: Re: ". */
export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`
}
