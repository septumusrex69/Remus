import { describe, expect, it } from 'vitest'
import {
  OTHER_CHOICE, REQUEST_DEPARTMENTS, answerBody, answerTo, base64Bytes, choicesOk, mayAnswer, parseChoices, tickedOf, waitingOnAsker, fileProblem, fitWithin, mayDecide, mayTest, mayWithdraw, onShelf, SHELVES, paneOf,
  parseReviewGroups, requestLabel, sortRequests, stageOf, testState, titleOf,
} from './changeRequests'
import { timeAgo } from './notifications'
import migration from '../../supabase/migrations/0017_change_requests.sql?raw'
import choicesMigration from '../../supabase/migrations/0018_change_request_choices.sql?raw'

/* Raptor's check-change-requests, as Remus's vitest. */

describe('which pane, which department', () => {
  it('reads the pane off the address, most specific first', () => {
    expect(paneOf('/quotes/abc')).toEqual({ pane: 'Quotes', department: 'Quotes' })
    expect(paneOf('/expenses/capture')).toEqual({ pane: 'Expenses', department: 'Money' })
    expect(paneOf('/schedule?week=2')).toEqual({ pane: 'Schedule', department: 'Crew & schedule' })
    expect(paneOf('/clients/company/1')).toEqual({ pane: 'Clients', department: 'Clients & mail' })
    expect(paneOf('/')).toEqual({ pane: 'Dashboard', department: 'Whole system' })
    expect(paneOf('/nowhere')).toEqual({ pane: 'Other', department: 'Whole system' })
    expect(paneOf(null)).toEqual({ pane: 'Dashboard', department: 'Whole system' })
  })

  it('offers exactly the departments the database accepts', () => {
    const m = migration.match(/department in \(([^)]*)\)/)
    expect(m, 'the department check is in the migration').toBeTruthy()
    const inDb = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    expect(inDb).toEqual([...REQUEST_DEPARTMENTS])
  })
})

describe('who may do what', () => {
  const asker = { id: 'a', role: 'Sales Representative' as const }
  const admin = { id: 'z', role: 'Administrator' as const }
  it('only an Administrator decides', () => {
    expect(mayDecide(admin)).toBe(true)
    expect(mayDecide(asker)).toBe(false)
    expect(mayDecide(null)).toBe(false)
  })
  it('the sender may withdraw while it is still Submitted', () => {
    expect(mayWithdraw(asker, { created_by: 'a', status: 'new' })).toBe(true)
    expect(mayWithdraw(asker, { created_by: 'a', status: 'accepted' })).toBe(false)
    expect(mayWithdraw(admin, { created_by: 'a', status: 'new' })).toBe(false)
  })
  it('the asker, or an Administrator for them, tests it', () => {
    expect(mayTest(asker, { created_by: 'a' })).toBe(true)
    expect(mayTest(admin, { created_by: 'a' })).toBe(true)
    expect(mayTest({ id: 'b', role: 'Liaison' }, { created_by: 'a' })).toBe(false)
  })
})

describe('where a request stands', () => {
  it('Reviewed is a Submitted request a night has read', () => {
    expect(stageOf({ status: 'new', reviewed_at: null })).toBe('Submitted')
    expect(stageOf({ status: 'new', reviewed_at: '2026-10-27T01:47:00Z' })).toBe('Reviewed')
    expect(stageOf({ status: 'done', reviewed_at: '2026-10-27T01:47:00Z' })).toBe('Released')
  })
  it('an answer counts only if it came after the last release', () => {
    const base = { status: 'done' as const, decided_at: '2026-10-27T10:00:00Z' }
    expect(testState({ ...base, tested_ok: true, tested_at: '2026-10-27T11:00:00Z' })).toBe('works')
    expect(testState({ ...base, tested_ok: true, tested_at: '2026-10-26T11:00:00Z' })).toBe('waiting')
    expect(testState({ ...base, tested_ok: null, tested_at: null })).toBe('waiting')
    expect(testState({ status: 'accepted', decided_at: null, tested_ok: false, tested_at: '2026-10-27T11:00:00Z' })).toBe('sent back')
    expect(testState({ status: 'new', decided_at: null, tested_ok: null, tested_at: null })).toBe('not done')
  })
  it('every request sits on exactly one shelf, the one whose move it is', () => {
    const cases = [
      [{ status: 'new', build_requested_at: null, tested_ok: null }, 'decide'],
      [{ status: 'accepted', build_requested_at: null, tested_ok: null }, 'decide'],
      [{ status: 'accepted', build_requested_at: '2026-10-28T00:00:00Z', tested_ok: null }, 'claude'],
      [{ status: 'building', build_requested_at: null, tested_ok: null }, 'claude'],
      [{ status: 'done', build_requested_at: null, tested_ok: null }, 'test'],
      [{ status: 'done', build_requested_at: null, tested_ok: false }, 'test'],
      [{ status: 'done', build_requested_at: null, tested_ok: true }, 'finished'],
      [{ status: 'declined', build_requested_at: null, tested_ok: null }, 'declined'],
    ] as const
    for (const [r, want] of cases) {
      expect(SHELVES.map(([s]) => s).filter((s) => s !== 'all' && onShelf(r, s))).toEqual([want])
      expect(onShelf(r, 'all')).toBe(true)
    }
  })
  it('a title: the night’s, else the first line written', () => {
    expect(titleOf({ review_title: 'Quotes · Show the deposit', description: 'x' })).toBe('Quotes · Show the deposit')
    expect(titleOf({ review_title: null, description: '\nFirst line\nsecond' })).toBe('First line')
    expect(requestLabel({ number: 12 })).toBe('R-12')
  })
  it('high first, then newest', () => {
    const rows = [
      { number: 1, priority: 'normal' as const, created_at: '2026-10-26T08:00:00Z' },
      { number: 2, priority: 'high' as const, created_at: '2026-10-20T08:00:00Z' },
      { number: 3, priority: 'normal' as const, created_at: '2026-10-27T08:00:00Z' },
    ]
    expect(sortRequests(rows).map((r) => r.number)).toEqual([2, 3, 1])
  })
})

describe('files', () => {
  it('a picture is shrunk, never enlarged', () => {
    expect(fitWithin(3200, 2400)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(0, 10)).toEqual({ width: 0, height: 0 })
  })
  it('only pictures and PDFs; a PDF at most 5 MB', () => {
    expect(fileProblem({ name: 'a.png', type: 'image/png', size: 50e6 })).toBeNull()
    expect(fileProblem({ name: 'a.pdf', type: 'application/pdf', size: 6 * 1048576 })).toMatch(/5 MB/)
    expect(fileProblem({ name: 'a.docx', type: 'application/msword', size: 10 })).toMatch(/not a picture/)
  })
  it('base64 length to bytes', () => {
    expect(base64Bytes('QUJD')).toBe(3)
    expect(base64Bytes('QUI=')).toBe(2)
    expect(base64Bytes('QQ==')).toBe(1)
  })
})

describe('the night’s groups, read defensively', () => {
  it('drops what it cannot read rather than drawing half', () => {
    const g = parseReviewGroups([
      { title: 'Quotes · deposit', request_numbers: ['3', 3, -1, 'x'], what: ' Show it ', questions: ['Which?', '', 4], size: 'small' },
      { title: '  ' },
      null,
      { title: 'Bank', size: 'huge' },
    ])
    expect(g).toEqual([
      { title: 'Quotes · deposit', request_numbers: [3], what: 'Show it', questions: ['Which?'], size: 'small' },
      { title: 'Bank', request_numbers: [], what: '', questions: [], size: null },
    ])
    expect(parseReviewGroups('nope')).toEqual([])
  })
})

describe('the bell', () => {
  it('says how long ago, roughly', () => {
    const now = Date.parse('2026-10-27T12:00:00Z')
    expect(timeAgo('2026-10-27T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-10-27T11:55:00Z', now)).toBe('5m ago')
    expect(timeAgo('2026-10-27T09:00:00Z', now)).toBe('3h ago')
    expect(timeAgo('2026-10-25T12:00:00Z', now)).toBe('2d ago')
  })
})

/* Raptor · Handoff 12's newest: a question with options to tick, and who a request waits on. */
describe('a question with options to tick', () => {
  it('reads choices one per line, numbering and bullets off, blanks and repeats gone, at most six', () => {
    expect(parseChoices("1. Show them greyed out\n2) Keep them hidden\n\n- Only on the phone\n• show them greyed out\nOther"))
      .toEqual(['Show them greyed out', 'Keep them hidden', 'Only on the phone'])
    expect(parseChoices('a\nb\nc\nd\ne\nf\ng')).toHaveLength(6)
  })
  it('one choice is not a choice; none is a question for words', () => {
    expect([choicesOk([]), choicesOk(['a']), choicesOk(['a', 'b'])]).toEqual([true, false, true])
  })
  it('what a tick sends', () => {
    expect(answerBody('Red', '')).toBe('Red')
    expect(answerBody(OTHER_CHOICE, '  ')).toBeNull()
    expect(answerBody(OTHER_CHOICE, ' Purple ')).toBe('Other: Purple')
    expect(answerBody(null, 'x')).toBeNull()
  })
  const q = { id: 'q', kind: 'question' as const, choices: ['Red', 'Orange'] }
  it('the answer is the latest comment pointing at the question', () => {
    expect(answerTo(q, [
      { kind: 'comment', answers: 'q', at: '2026-10-26T10:00:00Z', body: 'Red' },
      { kind: 'comment', answers: 'q', at: '2026-10-26T11:00:00Z', body: 'Orange' },
      { kind: 'comment', answers: null, at: '2026-10-26T12:00:00Z', body: 'Red' },
    ])?.body).toBe('Orange')
    expect(answerTo(q, [{ kind: 'question', answers: null, at: 'x' }])).toBeNull()
    expect([tickedOf(['Red', 'Orange'], 'Orange'), tickedOf(['Red'], 'Other: Purple'), tickedOf(['Red'], 'Blue')]).toEqual(['Orange', 'Other', null])
  })
  it('only the person who asked answers, and only a question with choices', () => {
    expect([mayAnswer({ id: 'u1' }, { created_by: 'u1' }, q), mayAnswer({ id: 'admin' }, { created_by: 'u1' }, q),
      mayAnswer({ id: 'u1' }, { created_by: 'u1' }, { kind: 'question', choices: null })]).toEqual([true, false, false])
  })
  it('an open request with an unanswered question waits on the person who asked', () => {
    const R = { id: 'r1', created_by: 'asker', status: 'accepted' as const }
    const ask = { id: 'q1', request_id: 'r1', kind: 'question' as const, by_id: 'admin', at: '2026-10-26T10:00:00Z', answers: null, choices: null }
    const tick = { ...ask, id: 'q2', choices: ['A', 'B'] }
    const reply = (over: object) => ({ id: 'c', request_id: 'r1', kind: 'comment' as const, by_id: 'asker', at: '2026-10-26T11:00:00Z', answers: null, choices: null, ...over })
    expect([waitingOnAsker(R, [ask]), waitingOnAsker(R, [ask, reply({})]), waitingOnAsker(R, [ask, reply({ at: '2026-10-26T09:00:00Z' })]),
      waitingOnAsker(R, [ask, reply({ by_id: 'admin' })])]).toEqual([true, false, true, true])
    expect([waitingOnAsker(R, [tick, reply({})]), waitingOnAsker(R, [tick, reply({ answers: 'q2' })])]).toEqual([true, false])
    expect([waitingOnAsker({ ...R, status: 'done' }, [ask]), waitingOnAsker({ ...R, id: 'other' }, [ask])]).toEqual([false, false])
  })
  it('the database holds the shape, and a comment by Claude is named Claude', () => {
    expect(choicesMigration).toMatch(/cardinality\(choices\) between 2 and 6/)
    expect(choicesMigration).toMatch(/check \(answers is null or kind = 'comment'\)/)
    expect(choicesMigration).toMatch(/q\.id = change_request_events\.answers and q\.kind = 'question' and q\.choices is not null\s+and q\.request_id = change_request_events\.request_id/)
    expect(choicesMigration).toMatch(/when new\.by_id is null then 'Claude'/)
  })
  it('the insert policy never reads its own table (Postgres refuses every insert if it does)', () => {
    const last = choicesMigration.slice(choicesMigration.lastIndexOf('alter policy change_request_events_insert'))
    expect(last.length).toBeGreaterThan(40)
    expect(last).toMatch(/public\.change_request_answers_ok\(answers, request_id\)/)
    expect(last).not.toMatch(/from public\.change_request_events/)
    expect(choicesMigration).toMatch(/function public\.change_request_answers_ok[\s\S]*security definer/)
  })
})
