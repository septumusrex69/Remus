import { describe, expect, it } from 'vitest'
import { archivedMessage, bumpUnread, canBeArchived, tabOf } from './mailTabs'

const mail = (over: Partial<{ isSent: boolean; isJunk: boolean; doneAt: string | null }> = {}) => ({
  isSent: false, isJunk: false, doneAt: null, ...over,
})

describe('mail tabs (Archive, Raptor S16)', () => {
  it('puts a message on exactly one tab: sent, junk, archive, then the inbox', () => {
    expect(tabOf(mail())).toBe('all')
    expect(tabOf(mail({ doneAt: '2026-11-03T08:00:00Z' }))).toBe('done')
    expect(tabOf(mail({ isJunk: true }))).toBe('junk')
    // Junk somebody once archived is still junk; sent is sent.
    expect(tabOf(mail({ isJunk: true, doneAt: '2026-11-03T08:00:00Z' }))).toBe('junk')
    expect(tabOf(mail({ isSent: true, doneAt: '2026-11-03T08:00:00Z' }))).toBe('sent')
  })

  it('archives only inbox mail, never junk or sent', () => {
    expect(canBeArchived(mail())).toBe(true)
    expect(canBeArchived(mail({ doneAt: '2026-11-03T08:00:00Z' }))).toBe(true)
    expect(canBeArchived(mail({ isJunk: true }))).toBe(false)
    expect(canBeArchived(mail({ isSent: true }))).toBe(false)
  })

  it('moves the unread count from the Inbox to Archive and back, never below nought', () => {
    const counts = { all: 3, done: 0, junk: 1, sent: 0 }
    const unread = mail()
    const archived = mail({ doneAt: '2026-11-03T08:00:00Z' })
    expect(bumpUnread(bumpUnread(counts, unread, -1), archived, 1)).toEqual({ all: 2, done: 1, junk: 1, sent: 0 })
    expect(bumpUnread({ all: 0, done: 0, junk: 0, sent: 0 }, unread, -1).all).toBe(0)
  })

  it('says where the mail went', () => {
    expect(archivedMessage(1, true, true)).toMatch(/under Archive, where Move to inbox puts it back/)
    expect(archivedMessage(1, false, true)).toBe('Moved back to your inbox.')
    expect(archivedMessage(3, true)).toBe('3 emails archived — under Archive, where Move to inbox puts them back.')
    expect(archivedMessage(1, false)).toBe('1 email back in your inbox.')
  })
})
