import { describe, expect, it } from 'vitest'
import { matchesAny, phoneForms, requestNumberIn } from './globalSearch'

/* Raptor's check-global-search, as Remus's vitest (Raptor · Handoff 14, copied in Remus · Handoff 2). */
describe('search everything', () => {
  it('reads a phone number in both its 0... and 27... forms', () => {
    expect(phoneForms('082 123 4567')).toEqual(['0821234567', '27821234567'])
    expect(phoneForms('+27 82 123 4567')).toEqual(['27821234567', '0821234567'])
    expect(phoneForms('')).toEqual([])
  })
  it('finds a phone number however it is typed', () => {
    const fields = ['Jan Smit', '+27 82 123 4567']
    expect(matchesAny(fields, '0821234567')).toBe(true)
    expect(matchesAny(fields, '082 123 4567')).toBe(true)
    expect(matchesAny(fields, '27821234567')).toBe(true)
    expect(matchesAny(fields, '0831234567')).toBe(false)
  })
  it('finds a full name in either order, and any field', () => {
    expect(matchesAny(['Jan', 'Smit'], 'smit jan')).toBe(true)
    expect(matchesAny(['Jan Smit'], 'jan smit')).toBe(true)
    expect(matchesAny(['Q-0012', '12 Main Road, Paarl'], 'main road')).toBe(true)
    expect(matchesAny(['Jan Smit', null, undefined], 'piet')).toBe(false)
    expect(matchesAny(['Jan Smit'], '   ')).toBe(false)
  })
  it('knows a request number', () => {
    expect(requestNumberIn('R-6')).toBe(6)
    expect(requestNumberIn('r12')).toBe(12)
    expect(requestNumberIn('Roof')).toBe(null)
  })
})
