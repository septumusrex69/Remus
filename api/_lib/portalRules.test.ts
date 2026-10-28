import { describe, expect, it } from 'vitest'
import {
  codeSenderOrder, isPortalToken, normaliseCode, normalisePortalEmail, portalCodeCheck, portalInvoice, projectProgress,
  resendDecision, stageState, todayJhb,
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
