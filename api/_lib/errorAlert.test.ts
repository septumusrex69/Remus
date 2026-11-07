import { describe, expect, it } from 'vitest'
import { ALERTS_PER_HOUR, fingerprint, pathOf, readReport, shouldAlert } from './errorAlert.js'

/* Remus · Handover 8: crash reports (Raptor 55a7520's check-error-alert, as vitest). */
describe('crash reports (Raptor 55a7520: "get told when it breaks")', () => {
  it('the same bug is one fingerprint, whatever id or amount it carries', () => {
    const a = fingerprint({ source: 'render', message: 'TypeError: cannot read 12 of 4a1b2c3d-1111-2222-3333-444455556666', stack: 'x\n    at Page (/assets/index-AbCd1234.js:10:20)' })
    const b = fingerprint({ source: 'render', message: 'TypeError: cannot read 99 of 9f1b2c3d-1111-2222-3333-444455556666', stack: 'x\n    at Page (/assets/index-ZzYy9876.js:11:5)' })
    expect(a).toBe(b)
    expect(fingerprint({ source: 'window', message: 'other', stack: '' })).not.toBe(a)
  })
  it('told about once, and at most a few an hour', () => {
    expect(ALERTS_PER_HOUR).toBeLessThanOrEqual(5)
    expect([shouldAlert(false, 0), shouldAlert(false, ALERTS_PER_HOUR - 1), shouldAlert(false, ALERTS_PER_HOUR), shouldAlert(true, 0)])
      .toEqual([true, true, false, false])
  })
  it('what the browser sends is checked and capped', () => {
    expect(readReport({})).toBeNull()
    const r = readReport({ message: 'x'.repeat(5000), source: 'nonsense', url: 'https://remus-xi.vercel.app/quotes?q=1' }, 'UA')!
    expect([r.message.length, r.source, r.userAgent]).toEqual([1000, 'window', 'UA'])
    expect(pathOf(r.url)).toBe('/quotes?q=1')
    expect(pathOf('not a url')).toBeNull()
  })
})
