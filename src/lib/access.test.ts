import { describe, expect, it } from 'vitest'
import { accessOf, editsQuotes, profileFor, seesBudget, seesMoney, seesQuotes, type Access } from './access'

describe('who sees what', () => {
  it('reads the role and the job', () => {
    expect(accessOf({ role: 'Administrator', job: 'site_manager' })).toBe('admin')
    expect(accessOf({ role: 'Read Only' })).toBe('read_only')
    expect(accessOf({ role: 'Sales Representative', job: 'contractor' })).toBe('contractor')
    expect(accessOf({ role: 'Sales Representative', job: 'site_manager' })).toBe('site_manager')
    // Unknown or missing is the least access.
    expect(accessOf({ role: 'Sales Representative' })).toBe('site_manager')
    expect(accessOf(null)).toBe('site_manager')
  })
  it('writes back what it reads', () => {
    for (const a of ['admin', 'read_only', 'contractor', 'site_manager'] as Access[]) expect(accessOf(profileFor(a))).toBe(a)
  })
  it('money for Administrators only; budget for contractors too; quotes not for site managers', () => {
    expect((['admin', 'read_only', 'contractor', 'site_manager'] as Access[]).map((a) => [seesMoney(a), seesBudget(a), seesQuotes(a), editsQuotes(a)]))
      .toEqual([[true, true, true, true], [true, true, true, true], [false, true, true, false], [false, false, false, false]])
  })
})
