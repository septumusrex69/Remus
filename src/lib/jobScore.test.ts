import { describe, expect, it } from 'vitest'
import { actualCost, scoreJob, type CostSplit } from './jobScore'
import { projectCrewCost, wageList, type CrewSources } from './crewDays'
import { lastMonths, monthlyProfit, overheadRecovery } from './companyProfit'
import type { Expense, Invoice, StageBooking, Worker } from '../types'

const exp = (category: Expense['category'], amount: number, date = '2026-10-05', project_id: string | null = 'p1') =>
  ({ id: Math.random().toString(), project_id, date, category, amount_excl: amount, vat: 0 }) as Expense
const split = (material: number, labour: number, sub = 0, other = 0): CostSplit => ({ material, labour, subcontractor: sub, other, total: material + labour + sub + other })
const worker = new Map<string, Worker>([['w1', { id: 'w1', day_cost: 500 } as Worker]])
// Mon 5 Oct 2026 to Fri 9 Oct: five working days.
const booking = { id: 'b1', stage_id: 's1', worker_id: 'w1', start_date: '2026-10-05', end_date: '2026-10-09' } as StageBooking

describe('quoted against actual, for one job', () => {
  it('counts the crew only up to today, and adds it to labour', () => {
    const crew: CrewSources = { bookings: [booking], register: [], stageProject: new Map([['s1', 'p1']]), workers: worker }
    expect(projectCrewCost(crew, 'p1', '2026-10-06')).toBe(1000)
    expect(projectCrewCost(crew, 'p1', '2026-11-01')).toBe(2500)
    const a = actualCost([exp('materials', 1000), exp('labour', 200), exp('transport', 50)], 2500)
    expect(a).toEqual({ material: 1000, labour: 2700, subcontractor: 0, other: 50, total: 3750 })
  })
  const base = { contract: 100_000, variations: 0, start: '2026-10-01', end: '2026-10-30', today: '2026-11-15' }
  it('a finished job: over, on budget, or under enough to ask whether it was quoted high', () => {
    const quoted = split(40_000, 30_000)
    const over = scoreJob({ ...base, quoted, actual: split(50_000, 30_000), status: 'completed' })
    expect(over.tone).toBe('bad')
    expect(over.headline).toMatch(/over budget by R 10 000 \(14%\)/)
    expect(over.detail).toMatch(/materials/)
    expect(scoreJob({ ...base, quoted, actual: split(41_000, 30_500), status: 'completed' }).tone).toBe('good')
    const under = scoreJob({ ...base, quoted, actual: split(30_000, 25_000), status: 'completed' })
    expect(under.tone).toBe('warn')
    expect(under.detail).toMatch(/quoted high/)
    expect(under.quotedProfit).toBe(30_000)
    expect(under.profitNow).toBe(45_000)
  })
  it('a running job: warns when spending runs well ahead of the calendar', () => {
    const quoted = split(40_000, 30_000)
    const early = { ...base, today: '2026-10-07', status: 'active' as const }
    expect(scoreJob({ ...early, quoted, actual: split(35_000, 0) }).tone).toBe('warn')
    expect(scoreJob({ ...early, quoted, actual: split(5_000, 2_000) }).tone).toBe('good')
    const r = scoreJob({ ...early, quoted, actual: split(75_000, 0) })
    expect(r.tone).toBe('bad')
    expect(r.profitForecast).toBe(25_000)
  })
  it('no quoted cost: says so instead of guessing', () => {
    expect(scoreJob({ ...base, quoted: null, actual: split(1, 0), status: 'active' }).tone).toBe('neutral')
  })
})

describe('what the company made', () => {
  it('lists the months oldest first, across a year end', () => {
    expect(lastMonths('2027-02-10', 3)).toEqual(['2026-12', '2027-01', '2027-02'])
  })
  it('invoiced − job costs − crew = job profit; − overheads = net', () => {
    const invoices = [
      { issue_date: '2026-10-10', amount_excl: 50_000, status: 'sent' },
      { issue_date: '2026-10-11', amount_excl: 9_999, status: 'draft' },
      { issue_date: '2026-09-30', amount_excl: 7_000, status: 'paid' },
    ] as Invoice[]
    const expenses = [exp('materials', 20_000), exp('overheads', 5_000, '2026-10-02', null), exp('other', 1_000, '2026-09-15', null)]
    const [sep, oct] = monthlyProfit({ months: ['2026-09', '2026-10'], invoices, expenses, crew: { bookings: [booking], register: [], stageProject: new Map([['s1', 'p1']]), workers: worker }, today: '2026-10-31' })
    expect(oct).toEqual({ month: '2026-10', income: 50_000, projectCosts: 20_000, crew: 2500, jobProfit: 27_500, overheads: 5_000, net: 22_500 })
    expect(sep.net).toBe(6_000)
    const r = overheadRecovery([sep, oct])
    expect(r.monthlyOverheads).toBe(3_000)
    expect(r.pctOnCost).toBe(26.7)
  })
})

describe('the crew register', () => {
  const crew = (register: CrewSources['register']): CrewSources => ({ bookings: [booking], register, stageProject: new Map([['s1', 'p1']]), workers: worker })
  const reg = (day: string, days: number, project_id = 'p1', day_cost = 500) => ({ id: day + project_id, worker_id: 'w1', project_id, stage_id: project_id === 'p1' ? 's1' : null, day, days, day_cost, note: null, created_at: '' })
  it('the register wins over the booking: absent, half a day, or on another site', () => {
    const c = crew([reg('2026-10-06', 0), reg('2026-10-07', 0.5), reg('2026-10-08', 1, 'p2', 600)])
    // Mon booked (500) + Tue absent (0) + Wed half (250) + Thu on p2 (not here) + Fri booked (500)
    expect(projectCrewCost(c, 'p1', '2026-10-31')).toBe(1250)
    expect(projectCrewCost(c, 'p2', '2026-10-31')).toBe(600)
  })
  it('the wage list: confirmed days, unconfirmed booked days, and the money', () => {
    const [l] = wageList(crew([reg('2026-10-05', 1), reg('2026-10-06', 1, 'p1', 550)]), '2026-10-05', '2026-10-11')
    expect(l).toMatchObject({ worker_id: 'w1', confirmed: 2, unconfirmed: 3, amount: 2550, unconfirmedAmount: 1500, sites: ['p1'] })
  })
})
