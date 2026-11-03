import { describe, expect, it } from 'vitest'
import {
  cleanPersonName, codeSenderOrder, isPortalToken, normaliseCode, normalisePortalEmail, passwordFailure, portalAcceptNotice, portalCodeCheck,
  portalCodeEmail, portalInviteEmail, portalInvoice, portalPasswordProblem, portalProgressNotes, portalQuoteAcceptProblem, portalSessionDays,
  projectProgress, resendDecision, stageState, todayJhb,
} from './portalRules.js'

describe('signing in to the client portal', () => {
  it('reads an address and a code however they were typed', () => {
    expect(normalisePortalEmail('  Jan@Build.co.za ')).toBe('jan@build.co.za')
    expect(normalisePortalEmail('not an address')).toBe(null)
    expect(normaliseCode('123 456')).toBe('123456')
    expect(normaliseCode('12345')).toBe(null)
    expect(isPortalToken('a'.repeat(64))).toBe(true)
    expect(isPortalToken('A'.repeat(64))).toBe(false)
  })
  it('a code is compared only while fresh and with tries left', () => {
    const now = Date.parse('2026-10-28T10:00:00Z')
    expect(portalCodeCheck(null, now)).toBe('none')
    expect(portalCodeCheck({ expiresAt: '2026-10-28T09:59:00Z', attempts: 0 }, now)).toBe('expired')
    expect(portalCodeCheck({ expiresAt: '2026-10-28T10:05:00Z', attempts: 5 }, now)).toBe('used-up')
    expect(portalCodeCheck({ expiresAt: '2026-10-28T10:05:00Z', attempts: 4 }, now)).toBe('compare')
  })
  it('a minute between codes and five an hour', () => {
    const now = Date.parse('2026-10-28T10:00:00Z')
    expect(resendDecision({ sentAt: '2026-10-28T09:59:30Z', windowStartedAt: '2026-10-28T09:59:30Z', sendsInWindow: 1 }, now).ok).toBe(false)
    expect(resendDecision({ sentAt: '2026-10-28T09:58:00Z', windowStartedAt: '2026-10-28T09:30:00Z', sendsInWindow: 5 }, now).ok).toBe(false)
    expect(resendDecision({ sentAt: '2026-10-28T09:58:00Z', windowStartedAt: '2026-10-28T08:30:00Z', sendsInWindow: 5 }, now)).toMatchObject({ ok: true, sendsInWindow: 1 })
  })
  it('the inviter sends the code first, then others with a mailbox', () => {
    const staff = [
      { id: 'b', name: 'Bea', hasMailbox: true, active: true },
      { id: 'a', name: 'Al', hasMailbox: true, active: true },
      { id: 's', name: 'Stephan', hasMailbox: true, active: true },
      { id: 'x', name: 'Xen', hasMailbox: false, active: true },
    ]
    expect(codeSenderOrder('s', staff)).toEqual(['s', 'a', 'b'])
  })
})

describe('what the client sees', () => {
  const stages = [
    { start_date: '2026-10-01', end_date: '2026-10-10' },
    { start_date: '2026-10-11', end_date: '2026-10-20' },
    { start_date: null, end_date: null },
  ]
  it('each stage by its dates', () => {
    expect(stages.map((s) => stageState(s, '2026-10-15'))).toEqual(['done', 'on', 'unplanned'])
    expect(stageState(stages[1], '2026-10-05')).toBe('next')
  })
  it('how far along, by the plan', () => {
    expect(projectProgress('active', stages, '2026-10-15')).toBe(75)
    expect(projectProgress('active', stages, '2026-09-01')).toBe(0)
    expect(projectProgress('active', stages, '2026-12-01')).toBe(100)
    expect(projectProgress('completed', [], '2026-10-15')).toBe(100)
    expect(projectProgress('active', [{ start_date: null, end_date: null }], '2026-10-15')).toBe(null)
  })
  it('an invoice: paid by payments, overdue by date', () => {
    const inv = { number: 'INV-1', issue_date: '2026-10-01', due_date: '2026-10-10', description: null, amount_excl: 1000, vat: 150, status: 'sent' }
    expect(portalInvoice(inv, 400, '2026-10-15')).toMatchObject({ total: 1150, paid: 400, owing: 750, state: 'overdue' })
    expect(portalInvoice(inv, 400, '2026-10-05')).toMatchObject({ state: 'open' })
    expect(portalInvoice(inv, 1150, '2026-10-15')).toMatchObject({ owing: 0, state: 'paid' })
  })
  it('today is Johannesburg’s', () => {
    expect(todayJhb(Date.parse('2026-10-27T22:30:00Z'))).toBe('2026-10-28')
  })
})

describe('the portal password (Remus · Handover 8, from Raptor S16)', () => {
  it('length is the rule; not one letter repeated, not the address', () => {
    expect(portalPasswordProblem('the green gate', 'jan@build.co.za')).toBe(null)
    expect(portalPasswordProblem('short', null)).toMatch(/at least 8/)
    expect(portalPasswordProblem('zzzzzzzzzz', null)).toMatch(/more than one/)
    expect(portalPasswordProblem('JAN@build.co.za', 'jan@build.co.za')).toMatch(/other than your email/)
    expect(portalPasswordProblem(undefined, null)).toMatch(/at least 8/)
  })
  it('keep me signed in: a month, else a day', () => {
    expect(portalSessionDays(true)).toBe(30)
    expect(portalSessionDays(false)).toBe(1)
  })
  it('five wrong in a row lock it for fifteen minutes, and the count starts again', () => {
    const now = Date.parse('2026-11-03T10:00:00Z')
    expect(passwordFailure(0, now)).toEqual({ failures: 1, lockedUntil: null })
    expect(passwordFailure(3, now)).toEqual({ failures: 4, lockedUntil: null })
    expect(passwordFailure(4, now)).toEqual({ failures: 0, lockedUntil: '2026-11-03T10:15:00.000Z' })
  })
  it('the emails: code first, then a password; a button to the portal; nothing unescaped', () => {
    const code = portalCodeEmail({ name: 'Jan<b> Smit', code: '123456', company: 'Urban Haus', url: 'https://x.test/portal', from: 'Stephan' })
    expect(code.subject).not.toContain('123456')
    expect(code.html).toContain('123456')
    expect(code.html).toContain('href="https://x.test/portal"')
    expect(code.html).toContain('Jan&lt;b&gt;')
    expect(code.html).toContain('choose a password')
    expect(code.text).toContain('123456')
    expect(code.text).not.toMatch(/<[a-z]/)
    const invite = portalInviteEmail({ name: 'Jan', company: 'Urban Haus', url: 'https://x.test/portal', from: 'Stephan' })
    expect(invite.html).not.toMatch(/no password/i)
    expect(invite.html).toContain('choose a password')
    expect(invite.text).toContain('https://x.test/portal')
  })
})

describe('portal part 2 (Remus · Handover 8)', () => {
  it('progress notes: only days with words, newest first, a fair number', () => {
    const notes = portalProgressNotes([
      { date: '2026-10-01', work_done: 'Foundations poured' },
      { date: '2026-10-03', work_done: '  ' },
      { date: '2026-10-05', work_done: ' Walls to window height ' },
      { date: '2026-10-02', work_done: null },
    ])
    expect(notes).toEqual([{ date: '2026-10-05', text: 'Walls to window height' }, { date: '2026-10-01', text: 'Foundations poured' }])
    expect(portalProgressNotes(Array.from({ length: 40 }, (_, i) => ({ date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, work_done: 'x' }))).length).toBe(30)
  })
  it('a quote is accepted only when sent, still valid, named and ticked', () => {
    const today = '2026-11-03'
    const sent = { status: 'sent', valid_until: '2026-11-30' }
    const ok = { name: 'Jan  van der Merwe ', agreed: true }
    expect(portalQuoteAcceptProblem(sent, ok, today)).toBe(null)
    expect(portalQuoteAcceptProblem({ status: 'sent', valid_until: null }, ok, today)).toBe(null)
    expect(portalQuoteAcceptProblem({ status: 'sent', valid_until: '2026-11-03' }, ok, today)).toBe(null)
    expect(portalQuoteAcceptProblem(null, ok, today)).toMatch(/could not be found/)
    expect(portalQuoteAcceptProblem({ status: 'accepted', valid_until: null }, ok, today)).toMatch(/already been accepted/)
    expect(portalQuoteAcceptProblem({ status: 'declined', valid_until: null }, ok, today)).toMatch(/no longer/)
    expect(portalQuoteAcceptProblem({ status: 'sent', valid_until: '2026-11-02' }, ok, today)).toMatch(/valid-until/)
    expect(portalQuoteAcceptProblem(sent, { name: ' ', agreed: true }, today)).toMatch(/full name/)
    expect(portalQuoteAcceptProblem(sent, { name: 'Jan', agreed: 'yes' }, today)).toMatch(/Tick/)
    expect(cleanPersonName('  Jan   van der Merwe ')).toBe('Jan van der Merwe')
  })
  it('the bell says who, for which client, and which quote', () => {
    expect(portalAcceptNotice({ name: 'Jan Smit', client: 'Smit Holdings', number: 'Q-0012', title: 'Garage' }))
      .toBe('Jan Smit (Smit Holdings) accepted quote Q-0012 · Garage on the client portal. Convert it to a project when you are ready.')
    expect(portalAcceptNotice({ name: 'Jan Smit', client: 'Jan Smit', number: null, title: '' })).toMatch(/^Jan Smit accepted quote a quote/)
  })
})
