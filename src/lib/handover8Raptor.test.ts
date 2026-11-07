import { afterEach, describe, expect, it, vi } from 'vitest'
import { emailDayLabel } from './emailActivity'
import { FIRM_WORDS, replaceWord, tokens, unknownWords, type Speller } from './spellCheck'
import { IGNORED, isNoise, normalise } from './errorReporter'
import errorReports from '../../supabase/migrations/0049_error_reports.sql?raw'

/*
 * Remus · Handover 8 (7 Nov): what Raptor S18 and 55a7520 brought over, held here (Raptor's check-day-labels,
 * check-spell-check and check-error-alert, as vitest).
 */

describe('a date in a list always names a day; "Last week" is gone', () => {
  afterEach(() => { vi.useRealTimers() })
  it('Today, Yesterday, a weekday with its date, then the date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0))       // Saturday 7 November 2026, local time
    const at = (d: number, m = 10, y = 2026) => new Date(y, m, d, 13, 40).toISOString()
    expect([emailDayLabel(at(7)), emailDayLabel(at(6)), emailDayLabel(at(5)), emailDayLabel(at(1)), emailDayLabel(at(31, 9)),
      emailDayLabel(at(28, 9)), emailDayLabel(at(3, 8)), emailDayLabel(at(3, 8, 2025))])
      .toEqual(['Today', 'Yesterday', 'Thursday 5 Nov', 'Sunday 1 Nov', '31 October', '28 October', '3 September', '3 September 2025'])
  })
})

describe('spell check (Stephan: "by default it\'s on, but the user can switch it off")', () => {
  const speller: Speller = {
    correct: (w) => ['the', 'quote', 'is', 'attached', 'for', 'your', 'kitchen', 'client'].includes(w.toLowerCase()),
    suggest: (w) => (w === 'atached' ? ['attached'] : []),
  }
  it('names, acronyms, numbers, merge fields and addresses are never checked', () => {
    expect(tokens('Dear Thabo, the VAT on R 12 500 for {{name}} is at www.x.co.za or info@urbanhausgroup.co.za')).toEqual(['the', 'on', 'for', 'is', 'at', 'or'])
  })
  it('the doubtful words, with suggestions; the firm\'s words and a possessive pass', () => {
    expect(unknownWords('the quote is atached for your kitchen screed, the client\'s bakkie', speller))
      .toEqual([{ word: 'atached', suggestions: ['attached'] }])
    expect(unknownWords('atached', speller, ['atached'])).toEqual([])
    expect(FIRM_WORDS.every((w) => w === w.toLowerCase())).toBe(true)
  })
  it('a suggestion swaps whole words only', () => {
    expect(replaceWord('atached, reatached atached.', 'atached', 'attached')).toBe('attached, reatached attached.')
  })
})

describe('crash reports (Raptor 55a7520: "get told when it breaks")', () => {
  it('noise is never reported: extensions, a new version deployed, the ResizeObserver', () => {
    expect(IGNORED.length).toBeGreaterThan(3)
    expect([isNoise('ResizeObserver loop limit exceeded'), isNoise('TypeError: Failed to fetch dynamically imported module: /assets/x.js'),
      isNoise('TypeError: x is undefined')]).toEqual([true, true, false])
    expect(normalise(new TypeError('boom')).message).toBe('TypeError: boom')
  })
  it('the table: written by the server only, read by Administrators, and additive', () => {
    expect(errorReports).toMatch(/create table if not exists public\.error_reports/)
    expect(errorReports).toMatch(/alerted_at timestamptz/)
    expect(errorReports).not.toMatch(/for insert/)
    expect(/\bdrop\b/i.test(errorReports)).toBe(false)
  })
})
