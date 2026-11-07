import { describe, expect, it } from 'vitest'
import { crewReport, jobVersusOverhead, outstandingByClient, overheadsByKind, profitPerJob, quotesReport, returnsReport, slipsBySupplier, spendByCategory } from './reports'
import type { CrewSources } from './crewDays'
import type { SlipReturn } from './slipReturns'
import type { Expense, Invoice, Payment, Project, Quote, QuoteTotalsRow, Worker } from '../types'

/* THE REPORTS (Remus · Handover 8): each figure checked by hand. */
const project = (id: string, contract = 100_000) => ({ id, name: id, code: null, quote_id: null, site_address: null, status: 'active', start_date: null, end_date: null, contract_value: contract, budget: 0, notes: null, created_at: '', company_id: null, contact_id: null }) as Project
const invoice = (id: string, over: Partial<Invoice>): Invoice => ({ id, project_id: null, company_id: null, contact_id: null, number: id, issue_date: '2026-10-05', due_date: null, description: null, amount_excl: 1000, vat: 150, status: 'sent', created_at: '', ...over })
const expense = (over: Partial<Expense>): Expense => ({ id: Math.random().toString(36), project_id: null, date: '2026-10-10', category: 'materials', supplier: null, description: null, amount_excl: 100, vat: 15, receipt_url: null, receipt_path: null, receipt_number: null, ai_extracted: null, ai_suggestion: null, source: 'receipt', paid: true, stage_id: null, overhead_kind: null, created_at: '', ...over })
const worker = (id: string, day_cost: number) => ({ id, name: id.toUpperCase(), trade: null, grade: 'junior', day_cost, phone: null, notes: null, active: true, created_at: '' }) as Worker

const crew: CrewSources = {
  bookings: [],
  register: [
    { id: '1', worker_id: 'a', project_id: 'p1', stage_id: null, day: '2026-10-06', days: 1, day_cost: 500, note: null, created_at: '' },
    { id: '2', worker_id: 'a', project_id: 'p1', stage_id: null, day: '2026-10-07', days: 0.5, day_cost: 500, note: null, created_at: '' },
    { id: '3', worker_id: 'b', project_id: 'p2', stage_id: null, day: '2026-11-02', days: 1, day_cost: 400, note: null, created_at: '' },
    { id: '4', worker_id: 'b', project_id: 'p2', stage_id: null, day: '2026-09-30', days: 1, day_cost: 400, note: null, created_at: '' },
  ],
  stageProject: new Map(),
  workers: new Map([['a', worker('a', 500)], ['b', worker('b', 400)]]),
}

describe('reports', () => {
  it('profit per job: invoiced less slips less crew, in the period only', () => {
    const rows = profitPerJob({
      projects: [project('p1'), project('p2'), project('p3')],
      invoices: [
        invoice('i1', { project_id: 'p1', amount_excl: 10_000 }),
        invoice('i2', { project_id: 'p1', amount_excl: 5_000, status: 'draft' }),
        invoice('i3', { project_id: 'p2', amount_excl: 2_000, issue_date: '2026-09-01' }),
      ],
      expenses: [expense({ project_id: 'p1', amount_excl: 3_000 }), expense({ project_id: 'p1', amount_excl: -200 }), expense({ project_id: 'p2', amount_excl: 50 })],
      crew, from: '2026-10-01', to: '2026-10-31', today: '2026-11-07',
    })
    expect(rows.map((r) => [r.project.id, r.invoiced, r.slips, r.crew, r.profit, r.margin])).toEqual([
      ['p1', 10_000, 2_800, 750, 6_450, 64.5],
      ['p2', 0, 50, 0, -50, null],
    ])
  })

  it('spending by category and overheads by kind', () => {
    const ex = [
      expense({ category: 'materials', amount_excl: 300, vat: 45, project_id: 'p1' }),
      expense({ category: 'overheads', amount_excl: 900, vat: 135, overhead_kind: 'vehicle_fuel' }),
      expense({ category: 'overheads', amount_excl: 100, vat: 15, overhead_kind: 'vehicle_fuel' }),
      expense({ category: 'overheads', amount_excl: 50, vat: 0, overhead_kind: 'internet_phone' }),
    ]
    expect(spendByCategory(ex).map((r) => [r.name, r.count, r.excl, r.incl])).toEqual([['Overheads', 3, 1050, 1200], ['Materials', 1, 300, 345]])
    expect(overheadsByKind(ex).map((r) => [r.name, r.excl])).toEqual([['Vehicles: fuel', 1000], ['Internet & phones', 50]])
    expect(jobVersusOverhead(ex)).toEqual({ jobs: 300, overheads: 1050 })
  })

  it('outstanding by client, with the ageing', () => {
    const invoices = [
      invoice('a', { company_id: 'co', due_date: '2026-07-01' }),
      invoice('b', { company_id: 'co', due_date: '2026-11-30' }),
      invoice('c', { contact_id: 'ct', due_date: '2026-10-20' }),
    ]
    const payments = [{ id: 'p', invoice_id: 'a', project_id: null, date: '2026-08-01', amount: 150, method: 'eft', reference: null, created_at: '' }] as Payment[]
    const rows = outstandingByClient(invoices, payments, (r) => (r.company_id ? 'Acme' : 'Thandi'), new Date(2026, 10, 7))
    expect(rows.map((r) => [r.name, r.invoices, r.total, r.buckets['90+ days'], r.buckets.Current, r.buckets['1–30 days']])).toEqual([
      ['Acme', 2, 2150, 1000, 1150, 0],
      ['Thandi', 1, 1150, 0, 0, 1150],
    ])
  })

  it('quotes won and lost: the win rate counts only the decided ones', () => {
    const q = (id: string, status: Quote['status'], issue_date = '2026-10-01') => ({ id, status, issue_date }) as Quote
    const totals = new Map([['1', 1000], ['2', 2000], ['3', 4000], ['4', 8000], ['5', 16]].map(([id, v]) => [id as string, { total_excl: v } as QuoteTotalsRow]))
    const r = quotesReport([q('1', 'accepted'), q('2', 'declined'), q('3', 'sent'), q('4', 'expired'), q('5', 'accepted', '2025-01-01')], totals, '2026-10-01', '2026-10-31')
    expect(r.winRate).toBe(33)
    expect(r.wonValue).toBe(1000)
    expect(r.lostValue).toBe(10_000)
    expect(r.quotes).toHaveLength(4)
  })

  it('crew days and wages per job per month, and per person', () => {
    const r = crewReport(crew, '2026-09-01', '2026-11-30', '2026-11-07')
    expect(r.byJobMonth.map((x) => [x.projectId, x.month, x.days, x.wages])).toEqual([
      ['p2', '2026-09', 1, 400], ['p1', '2026-10', 1.5, 750], ['p2', '2026-11', 1, 400],
    ])
    expect(r.byWorker.map((x) => [x.name, x.days, x.wages, x.jobs])).toEqual([['B', 2, 800, 1], ['A', 1.5, 750, 1]])
  })

  it('slips by supplier: one row per store however it was spelt; credits count off', () => {
    const rows = slipsBySupplier([
      expense({ supplier: 'BUILDERS', amount_excl: 100, vat: 15 }),
      expense({ supplier: ' builders  ', amount_excl: 200, vat: 30, date: '2026-10-20' }),
      expense({ supplier: 'Builders', amount_excl: -50, vat: -7.5 }),
      expense({ supplier: null, amount_excl: 10, vat: 0 }),
    ])
    expect(rows.map((r) => [r.name, r.slips, r.excl, r.incl, r.credits, r.last])).toEqual([
      ['BUILDERS', 2, 250, 287.5, 57.5, '2026-10-20'],
      ['No supplier written', 1, 10, 10, 0, '2026-10-10'],
    ])
  })

  it('returns credited in the period, and what still waits', () => {
    const ret = (over: Partial<SlipReturn>) => ({ status: 'returned', returned_on: '2026-10-10', amount_incl: 100, credit_amount_incl: 100, ...over }) as SlipReturn
    const r = returnsReport([ret({}), ret({ credit_amount_incl: 80 }), ret({ returned_on: '2026-08-01' }), ret({ status: 'to_return', returned_on: null, amount_incl: 40 })], '2026-10-01', '2026-10-31')
    expect([r.returned.length, r.expected, r.credited, r.short, r.waiting.count, r.waiting.value]).toEqual([2, 200, 180, 20, 1, 40])
  })
})
