/**
 * The bell, read as a list of THINGS rather than a list of messages (Remus · Handoff 5, copied from
 * Raptor H13's `src/lib/notificationGroups.ts`).
 *
 * Raptor's firm, looking at its bell on 27 Oct: every line said "just now"; one request was there
 * twice (two replies, each its own line); and a request still showed as unread after it had been
 * opened and approved. Three rules follow, kept here apart from the menu so a test can hold them.
 */
import type { AppNotification } from './notifications'

/*
 * ONE LINE PER THING, AND THE LINK IS WHAT A THING IS. Every notification about one request opens
 * the same `/requests?r=N`. So notifications that share a link are one line: the newest message, how
 * many more, unread while any of them is. A notification with no link stands alone.
 */
export interface NotificationGroup {
  key: string
  /** The newest notification in the group: its message is the line. */
  latest: AppNotification
  /** Every id in the group, newest first -- pressing the line marks them all read. */
  ids: string[]
  /** How many besides the newest. */
  more: number
  unread: number
}

export function groupNotifications(list: AppNotification[]): NotificationGroup[] {
  const sorted = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const groups = new Map<string, NotificationGroup>()
  for (const n of sorted) {
    const key = n.link ? `link:${n.link}` : `id:${n.id}`
    const g = groups.get(key)
    if (!g) groups.set(key, { key, latest: n, ids: [n.id], more: 0, unread: n.read ? 0 : 1 })
    else { g.ids.push(n.id); g.more += 1; if (!n.read) g.unread += 1 }
  }
  /* Map keeps insertion order, and insertion was newest first: a group sits where its newest is. */
  return [...groups.values()]
}

/*
 * OPENING THE THING READS ITS NOTIFICATIONS. A link is open when the page is on its path and every
 * parameter it names is on the address with the same value -- /requests?r=8 is open on
 * /requests?view=list&r=8, and not on /requests?r=18. Acting on a request means opening it first,
 * so this ties the bell to the action without every button having to know the bell exists.
 */
export function linkIsOpen(link: string | null | undefined, pathname: string, search: string): boolean {
  if (!link) return false
  const [path, query = ''] = link.split('?')
  if (path !== pathname) return false
  const here = new URLSearchParams(search)
  for (const [k, v] of new URLSearchParams(query)) if (here.get(k) !== v) return false
  return true
}

/*
 * A DATE AND A TIME. "5m ago" told nobody when a thing happened once it was a day old; a
 * notification is a thing that happened, at a time. Johannesburg's day, so a 01:30 message is not
 * "yesterday" because the server runs on UTC.
 */
const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })
const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false })
const DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short' })
const DATE_YEAR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric' })

export function notificationWhen(iso: string, nowMs: number): string {
  const at = new Date(iso)
  const day = DAY.format(at)
  const today = DAY.format(new Date(nowMs))
  const yesterday = DAY.format(new Date(nowMs - 24 * 60 * 60 * 1000))
  const time = TIME.format(at)
  if (day === today) return `Today ${time}`
  if (day === yesterday) return `Yesterday ${time}`
  return `${(day.slice(0, 4) === today.slice(0, 4) ? DATE : DATE_YEAR).format(at)} ${time}`
}
