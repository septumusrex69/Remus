import { describe, expect, it } from 'vitest'
import { SHELVES, isParked, mayAnswer, onShelf, questionFor, waitingOn } from './changeRequests'
import parked from '../../supabase/migrations/0048_change_requests_parked.sql?raw'

/*
 * Remus · Handover 8 (7 Nov): Raptor S18's parked requests, the Big Boss's tick, and Claude's questions going to the
 * administrator who sent the request through. Raptor's check-change-requests S18 checks, as vitest.
 */
const P = '2026-11-06T08:00:00Z'
const R = (status: 'new' | 'accepted' | 'building' | 'done' | 'declined', over: object = {}) =>
  ({ status, build_requested_at: null, tested_ok: null, parked_at: null, ...over })

describe('parked (Stephan: "something that is parked for now. Until I can make another decision")', () => {
  it('the shelves, in order, Parked before Declined, All last', () => {
    expect(SHELVES.map(([s]) => s)).toEqual(['decide', 'claude', 'test', 'finished', 'parked', 'declined', 'all'])
  })
  it('a parked request is on Parked and All and nowhere else', () => {
    for (const r of [R('new', { parked_at: P }), R('accepted', { parked_at: P })]) {
      expect(isParked(r)).toBe(true)
      expect(SHELVES.map(([s]) => s).filter((s) => onShelf(r, s))).toEqual(['parked', 'all'])
    }
    expect(onShelf(R('new'), 'parked')).toBe(false)
  })
  it('the database holds the rules: the Big Boss only, a decision unparks, the queue is cleared, the count leaves it out', () => {
    expect(parked).toMatch(/or \(new\.parked_at is distinct from old\.parked_at\) then/)
    expect(parked).toMatch(/if new\.status is distinct from old\.status then\s+new\.parked_at := null/)
    expect(parked).toMatch(/if new\.status not in \('new', 'accepted'\) then/)
    expect(parked).toMatch(/new\.build_requested_at := null/)
    expect(parked).toMatch(/before update of status, build_requested_at, parked_at on public\.change_requests/)
    expect(parked).toMatch(/where status = 'new' and parked_at is null and coalesce\(public\.current_user_role\(\), ''\) = 'Administrator'/)
  })
  it('additive only: the word the Supabase connector stops on is nowhere in it', () => {
    expect(/\bdrop\b/i.test(parked)).toBe(false)
  })
})

describe('Claude\'s questions go to whoever sent it through (Stephan: "the question should be asked rather to the administrator who sent it through")', () => {
  const req = { id: 'r1', created_by: 'writer', status: 'accepted' as const, build_requested_by: 'sender', decided_by: 'boss' }
  it('Claude asks the one who queued it, else who decided, else who wrote it; an Administrator asks the writer', () => {
    expect([
      questionFor(req, { by_id: null }),
      questionFor({ ...req, build_requested_by: null }, { by_id: null }),
      questionFor({ ...req, build_requested_by: null, decided_by: null }, { by_id: null }),
      questionFor(req, { by_id: 'admin' }),
    ]).toEqual(['sender', 'boss', 'writer', 'writer'])
  })
  it('the request waits on that person, and their words answer a question that wants words', () => {
    const q = { id: 'q1', request_id: 'r1', kind: 'question' as const, by_id: null, at: '2026-11-06T10:00:00Z', answers: null, choices: null }
    const reply = (by: string) => ({ id: 'c', request_id: 'r1', kind: 'comment' as const, by_id: by, at: '2026-11-06T11:00:00Z', answers: null, choices: null })
    expect([waitingOn(req, [q]), waitingOn(req, [q, reply('writer')]), waitingOn(req, [q, reply('sender')])]).toEqual(['sender', 'sender', null])
  })
  it('who may tick: the one it is for, the writer and the Big Boss; another Administrator may not', () => {
    const q = { kind: 'question' as const, choices: ['a', 'b'], by_id: null }
    expect([
      mayAnswer({ id: 'sender' }, req, q), mayAnswer({ id: 'writer' }, req, q),
      mayAnswer({ id: 'stephan', is_boss: true }, req, q), mayAnswer({ id: 'admin' }, req, q),
    ]).toEqual([true, true, true, false])
  })
  it('the bell goes to the same person', () => {
    expect(parked).toMatch(/v_for := coalesce\(r\.build_requested_by, r\.decided_by, r\.created_by\)/)
  })
})
