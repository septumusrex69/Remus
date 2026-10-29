import { beforeEach, describe, expect, it } from 'vitest'
import { draftKeyFor, dropDraft, findDraft, listDrafts, saveDraft, type MailDraft } from './mailDrafts'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
  }
})

const draft = (key: string): Omit<MailDraft, 'savedAt'> => ({
  key, title: 'New email', to: 'a@b.co.za', cc: '', subject: 'Hi', body: 'Words', inReplyTo: null,
  companyId: null, contactId: null, forward: null,
})

describe('mail drafts', () => {
  it('keeps one per box, newest first, and drops it on send', () => {
    saveDraft(draft('one'), 1)
    saveDraft(draft('two'), 2)
    saveDraft({ ...draft('one'), body: 'More words' }, 3)
    expect(listDrafts().map((d) => d.key)).toEqual(['one', 'two'])
    expect(findDraft('one')?.body).toBe('More words')
    dropDraft('one')
    expect(findDraft('one')).toBeNull()
  })
  it('a reply, a forward and a new email are different boxes', () => {
    const reply = draftKeyFor({ title: 'Reply', inReplyTo: '<m1>' })
    const fwd = draftKeyFor({ title: 'Forward', forwardOf: 'm1' })
    expect(new Set([reply, fwd, draftKeyFor({ title: 'New email' })]).size).toBe(3)
    expect(draftKeyFor({ title: 'Reply', inReplyTo: '<m1>' })).toBe(reply)
  })
  it('a browser that refuses storage means no draft, never an error', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') },
    }
    expect(() => saveDraft(draft('x'))).not.toThrow()
    expect(listDrafts()).toEqual([])
  })
})
