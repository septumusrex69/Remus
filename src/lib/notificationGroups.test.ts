import { describe, expect, it } from 'vitest'
import { groupNotifications, linkIsOpen, notificationWhen } from './notificationGroups'
import type { AppNotification } from './notifications'

const n = (id: string, link: string | null, at: string, read = false): AppNotification =>
  ({ id, type: 't', message: `m${id}`, link, read, created_at: at })

describe('the bell groups by link', () => {
  it('one line per link, newest first, counting the rest', () => {
    const g = groupNotifications([
      n('1', '/requests?r=6', '2026-10-27T08:00:00Z', true),
      n('2', '/requests?r=8', '2026-10-27T09:00:00Z'),
      n('3', '/requests?r=6', '2026-10-27T10:00:00Z'),
      n('4', null, '2026-10-27T07:00:00Z'),
      n('5', null, '2026-10-27T06:00:00Z'),
    ])
    expect(g.map((x) => x.latest.id)).toEqual(['3', '2', '4', '5'])
    expect(g[0]).toMatchObject({ more: 1, unread: 1, ids: ['3', '1'] })
  })
  it('a link is open only when every parameter it names matches', () => {
    expect(linkIsOpen('/requests?r=8', '/requests', '?view=list&r=8')).toBe(true)
    expect(linkIsOpen('/requests?r=8', '/requests', '?r=18')).toBe(false)
    expect(linkIsOpen('/requests', '/quotes', '')).toBe(false)
    expect(linkIsOpen(null, '/requests', '')).toBe(false)
  })
  it('tells the Johannesburg day and time', () => {
    const now = Date.parse('2026-10-28T10:00:00Z')
    expect(notificationWhen('2026-10-28T06:05:00Z', now)).toBe('Today 08:05')
    expect(notificationWhen('2026-10-27T22:30:00Z', now)).toBe('Today 00:30')
    expect(notificationWhen('2026-10-27T12:00:00Z', now)).toBe('Yesterday 14:00')
    expect(notificationWhen('2026-10-02T12:00:00Z', now)).toBe('2 Oct 14:00')
    expect(notificationWhen('2025-10-02T12:00:00Z', now)).toBe('2 Oct 2025 14:00')
  })
})
