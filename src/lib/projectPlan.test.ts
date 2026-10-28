import { describe, expect, it } from 'vitest'
import { clashesFor, stageActual, stagesFromQuote } from './projectPlan'
import type { Expense, StageBooking, Worker } from '../types'

const line = (section: string, kind: 'material' | 'labour' | 'subcontractor', qty: number, cost: number, price: number) =>
  ({ section, kind, quantity: qty, unit_cost: cost, unit_price: price, description: 'x' })

describe('stagesFromQuote', () => {
  it("dates the quote's stages in working days, from the start date", () => {
    const stages = stagesFromQuote(
      [line('Bathroom', 'material', 1, 2500, 3000), line('Bathroom', 'labour', 2, 900, 1125), line('Basin', 'subcontractor', 1, 1500, 1650)],
      [
        { name: 'Bathroom', duration_days: 2, start_mode: 'start', start_ref: null, lag_days: 0 },
        { name: 'Basin', duration_days: 2, start_mode: 'with', start_ref: 'Bathroom', lag_days: 1 },
      ],
      '2026-10-30', // a Friday
    )
    expect(stages.map((s) => [s.name, s.start_date, s.end_date])).toEqual([
      ['Bathroom', '2026-10-30', '2026-11-02'], // Fri + Mon
      ['Basin', '2026-11-02', '2026-11-03'], // a day later: Mon + Tue
    ])
    expect(stages[0]).toMatchObject({ quoted_sell: 5250, quoted_material: 2500, quoted_labour: 1800, quoted_subcontractor: 0 })
    expect(stages[1].quoted_subcontractor).toBe(1500)
  })
  it('starts on the next working day when the start date is not one', () => {
    expect(stagesFromQuote([line('', 'material', 1, 1, 1)], [], '2026-09-24')[0].start_date).toBe('2026-09-25') // Heritage Day
  })
})

describe('stageActual', () => {
  const workers = new Map<string, Worker>([['w1', { id: 'w1', name: 'Sipho', trade: null, grade: 'senior', day_cost: 900, phone: null, notes: null, active: true, created_at: '' }]])
  const exp = (category: Expense['category'], amount: number, stage_id = 's1') => ({ stage_id, category, amount_excl: amount }) as Expense
  it('adds slips by category and labour from bookings up to today', () => {
    const bookings = [{ id: 'b1', stage_id: 's1', worker_id: 'w1', start_date: '2026-11-02', end_date: '2026-11-06', created_at: '' }] as StageBooking[]
    const crew = { bookings, register: [], stageProject: new Map([['s1', 'p1']]), workers }
    const a = stageActual('s1', [exp('materials', 2000), exp('transport', 300), exp('materials', 999, 's2')], crew, '2026-11-04')
    expect(a).toMatchObject({ material: 2000, other: 300, labour: 2700, labourDays: 3, total: 5000 })
    // The register wins: Tuesday half a day, Wednesday not there.
    const register = [
      { id: 'r1', worker_id: 'w1', project_id: 'p1', stage_id: 's1', day: '2026-11-03', days: 0.5, day_cost: 800, note: null, created_at: '' },
      { id: 'r2', worker_id: 'w1', project_id: 'p1', stage_id: 's1', day: '2026-11-04', days: 0, day_cost: 900, note: null, created_at: '' },
    ]
    expect(stageActual('s1', [], { ...crew, register }, '2026-11-04')).toMatchObject({ labour: 1300, labourDays: 1.5 })
  })
})

describe('clashesFor', () => {
  it('finds the same worker on overlapping days elsewhere', () => {
    const all = [
      { id: 'a', stage_id: 's1', worker_id: 'w1', start_date: '2026-11-02', end_date: '2026-11-04' },
      { id: 'b', stage_id: 's2', worker_id: 'w1', start_date: '2026-11-04', end_date: '2026-11-05' },
      { id: 'c', stage_id: 's3', worker_id: 'w2', start_date: '2026-11-02', end_date: '2026-11-05' },
    ] as StageBooking[]
    expect(clashesFor(all[0], all).map((b) => b.id)).toEqual(['b'])
  })
})
