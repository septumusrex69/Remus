import { describe, expect, it } from 'vitest'
import { scheduleStages } from './quoteMath'
import { scheduleStageRows } from '../../api/_lib/quoteSchedule'

// The PDF (api/) keeps its own copy of the timeline arithmetic; this holds the two together.
describe('the PDF timeline matches the screen', () => {
  const plans = [
    [
      { name: 'Bathroom', duration_days: 2, start_mode: 'start' as const, start_ref: null, lag_days: 0 },
      { name: 'Roof', duration_days: 1, start_mode: 'after' as const, start_ref: 'Bathroom', lag_days: 1 },
      { name: 'Kitchen', duration_days: 4, start_mode: 'with' as const, start_ref: 'Bathroom', lag_days: 1 },
    ],
    [
      { name: '', duration_days: 3, start_mode: 'after' as const, start_ref: null, lag_days: 2 },
      { name: 'Tiling', duration_days: 0, start_mode: 'after' as const, start_ref: 'Gone', lag_days: -5 },
      { name: 'Paint', duration_days: 2.4, start_mode: 'with' as const, start_ref: '', lag_days: -1 },
    ],
  ]
  for (const [i, p] of plans.entries()) {
    it(`plan ${i + 1}`, () => expect(scheduleStageRows(p)).toEqual(scheduleStages(p)))
  }
})
