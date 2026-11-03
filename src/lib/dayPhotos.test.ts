import { describe, expect, it } from 'vitest'
import { BRAND_PHOTOS, DEFAULT_PHOTOS } from './brandPhotos'
import { DAY_LINES, draftRowFor, johannesburgToday, lookFromRow, monthDays, monthStatus, nextMonth, photoOfTheDay } from './dayPhotos'

describe('the photo of the day', () => {
  it('walks every photograph before any repeats, the same for everybody on a day', () => {
    const days = monthDays('2026-11').concat(monthDays('2026-12'))
    const first = days.slice(0, BRAND_PHOTOS.length).map((d) => photoOfTheDay(d).id)
    expect(new Set(first).size).toBe(BRAND_PHOTOS.length)
    expect(photoOfTheDay('2026-11-01').id).toBe(BRAND_PHOTOS[0].id)
    expect(photoOfTheDay(days[BRAND_PHOTOS.length]).id).toBe(BRAND_PHOTOS[0].id)
    expect(photoOfTheDay('2026-10-31').id).toBe(BRAND_PHOTOS[BRAND_PHOTOS.length - 1].id)
  })

  it('has enough photographs and lines for a month', () => {
    expect(BRAND_PHOTOS.length).toBeGreaterThanOrEqual(28)
    expect(DAY_LINES.length).toBeGreaterThanOrEqual(31)
    expect(new Set(BRAND_PHOTOS.map((p) => p.id)).size).toBe(BRAND_PHOTOS.length)
  })

  it('knows the months', () => {
    expect(monthDays('2026-11')).toHaveLength(30)
    expect(monthDays('2027-02')).toHaveLength(28)
    expect(monthDays('2026-12')[30]).toBe('2026-12-31')
    expect(nextMonth('2026-12')).toBe('2027-01')
    expect(nextMonth('2026-01', -1)).toBe('2025-12')
  })

  it('changes at midnight in Johannesburg, not UTC', () => {
    expect(johannesburgToday(new Date('2026-11-02T22:30:00Z'))).toBe('2026-11-03')
    expect(johannesburgToday(new Date('2026-11-02T21:30:00Z'))).toBe('2026-11-02')
  })

  it('shows only an approved day; otherwise the photographs chosen on /photos, no line', () => {
    const draft = draftRowFor('2026-11-05')
    expect(lookFromRow(draft, { band: 'LMpO06hCJyI' })).toMatchObject({ approved: false, line: null })
    expect(lookFromRow(draft, { band: 'LMpO06hCJyI' }).photo.id).toBe('LMpO06hCJyI')
    expect(lookFromRow(null, null, 'login').photo.id).toBe(DEFAULT_PHOTOS.login)
    const ok = lookFromRow({ ...draft, approved_at: '2026-11-03T08:00:00Z', band_x: 130, login_y: 20 }, null)
    expect(ok.approved).toBe(true)
    expect(ok.photo.id).toBe(draft.photo_id)
    expect(ok.band.x).toBe(100)
    expect(ok.login.y).toBe(20)
    expect(ok.line).toBe(draft.line)
    // A photograph we no longer have: back to the chosen one.
    expect(lookFromRow({ ...draft, photo_id: 'gone', approved_at: 'x' }, null).approved).toBe(false)
    // No line typed: no name either.
    expect(lookFromRow({ ...draft, line: ' ', who: 'Someone', approved_at: 'x' }, null)).toMatchObject({ line: null, who: null })
  })

  it('counts how a month stands', () => {
    const rows = [{ ...draftRowFor('2026-11-01'), approved_at: 'x' }, draftRowFor('2026-11-02')]
    expect(monthStatus('2026-11', rows)).toEqual({ approved: 1, draft: 1, empty: 28 })
  })
})
