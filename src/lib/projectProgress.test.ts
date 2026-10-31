import { describe, expect, it } from 'vitest'
import { projectProgress } from './projectProgress'
import { projectProgress as portalProgress } from '../../api/_lib/portalRules'

const stages = [{ start_date: '2026-10-01', end_date: '2026-10-10' }, { start_date: '2026-10-11', end_date: '2026-10-30' }, { start_date: null, end_date: null }]

describe('project progress by the plan', () => {
  it('days behind us over all the days', () => {
    expect(projectProgress('active', stages, '2026-10-15')).toBe(50)
    expect(projectProgress('active', stages, '2026-09-01')).toBe(0)
    expect(projectProgress('active', stages, '2026-12-01')).toBe(100)
    expect(projectProgress('completed', [], '2026-10-15')).toBe(100)
    expect(projectProgress('active', [], '2026-10-15')).toBeNull()
  })
  it('the same figure the client sees in the portal', () => {
    for (const day of ['2026-09-30', '2026-10-01', '2026-10-07', '2026-10-20', '2026-10-30', '2026-11-02'])
      expect(projectProgress('active', stages, day)).toBe(portalProgress('active', stages, day))
  })
})
