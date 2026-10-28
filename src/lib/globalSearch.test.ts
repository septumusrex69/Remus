import { describe, expect, it } from 'vitest'
import { matchesAny, phoneForms, requestNumberOf } from './globalSearch'

describe('search everything', () => {
  it('a phone number in any of the ways it is written', () => {
    expect(phoneForms('+27 82 123 4567')).toEqual(['27821234567', '0821234567'])
    expect(phoneForms('082 123 4567')).toEqual(['0821234567', '27821234567'])
    for (const typed of ['082 123 4567', '0821234567', '+27 82 123 4567', '1234567']) {
      expect(matchesAny(['Jan', '082-123-4567'], typed)).toBe(true)
    }
    expect(matchesAny(['Jan', '082-123-4567'], '0831234567')).toBe(false)
  })
  it('words in any order, and the email', () => {
    expect(matchesAny(['John Smith'], 'smith john')).toBe(true)
    expect(matchesAny(['John Smith', 'js@build.co.za'], 'build.co')).toBe(true)
    expect(matchesAny(['John Smith'], 'smith peter')).toBe(false)
    expect(matchesAny(['John Smith'], '  ')).toBe(false)
  })
  it('R-6 is request 6', () => {
    expect(requestNumberOf('R-6')).toBe(6)
    expect(requestNumberOf('r 12')).toBe(12)
    expect(requestNumberOf('Roof')).toBe(null)
  })
})
