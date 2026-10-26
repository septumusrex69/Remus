import { describe, expect, it } from 'vitest'
import { addWorkingDays, isWorkingDay, nextWorkingDay, overlaps, publicHolidays, workingDaysBetween } from './workdays'

describe('South African working days', () => {
  it('knows the holidays, Easter included', () => {
    const h = publicHolidays(2026)
    expect(h.has('2026-04-03')).toBe(true) // Good Friday 2026
    expect(h.has('2026-04-06')).toBe(true) // Family Day 2026
    expect(h.has('2026-09-24')).toBe(true)
    expect(h.has('2026-12-25')).toBe(true)
  })
  it('moves a Sunday holiday to the Monday', () => {
    // 16 June 2024 was a Sunday; Monday 17 June was off.
    expect(publicHolidays(2024).has('2024-06-17')).toBe(true)
    expect(isWorkingDay('2024-06-17')).toBe(false)
    // Christmas 2022 was a Sunday: 26th is Day of Goodwill anyway, so the 27th was off.
    expect(publicHolidays(2022).has('2022-12-27')).toBe(true)
  })
  it('skips weekends and holidays when counting', () => {
    expect(isWorkingDay('2026-10-24')).toBe(false) // Saturday
    expect(nextWorkingDay('2026-10-24')).toBe('2026-10-26')
    expect(addWorkingDays('2026-10-23', 1)).toBe('2026-10-26') // Friday + 1 = Monday
    expect(addWorkingDays('2026-09-23', 1)).toBe('2026-09-25') // over Heritage Day
    expect(workingDaysBetween('2026-10-26', '2026-11-06')).toBe(10)
    expect(workingDaysBetween('2026-11-06', '2026-10-26')).toBe(0)
  })
  it('spots overlapping bookings', () => {
    expect(overlaps({ start_date: '2026-11-02', end_date: '2026-11-04' }, { start_date: '2026-11-04', end_date: '2026-11-06' })).toBe(true)
    expect(overlaps({ start_date: '2026-11-02', end_date: '2026-11-03' }, { start_date: '2026-11-04', end_date: '2026-11-06' })).toBe(false)
  })
})
