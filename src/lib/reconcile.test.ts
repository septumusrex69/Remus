import { describe, expect, it } from 'vitest'
import { expenseCandidates, incomeCandidates, reconcile, supplierSimilarity, type ExpenseInput } from './reconcile'

describe('supplierSimilarity', () => {
  it('matches whole names, acronyms and abbreviations', () => {
    expect(supplierSimilarity('Builders Warehouse', 'POS PURCHASE BUILDERS WAREHOUSE MIDRAND')).toBe(1)
    expect(supplierSimilarity('Builders Warehouse', 'BWH MIDRAND 4402')).toBeGreaterThanOrEqual(0.6)
    expect(supplierSimilarity('Cashbuild', 'CASHBLD PRETORIA')).toBeGreaterThanOrEqual(0.6)
    expect(supplierSimilarity('Builders Warehouse', 'ENGEN GARAGE N1')).toBeLessThan(0.3)
    expect(supplierSimilarity(null, 'ANYTHING')).toBe(0)
  })
})

const exp = (id: string, date: string, supplier: string, incl: number): ExpenseInput => ({
  id,
  date,
  supplier,
  amount_excl: Math.round((incl / 1.15) * 100) / 100,
  vat: Math.round((incl - incl / 1.15) * 100) / 100,
})

describe('expenseCandidates', () => {
  it('needs same incl amount and ±5 days', () => {
    const tx = { id: 't', date: '2026-10-05', description: 'BUILDERS WAREHOUSE', amount: -1150 }
    const c = expenseCandidates(tx, [
      exp('a', '2026-10-04', 'Builders Warehouse', 1150),
      exp('b', '2026-10-20', 'Builders Warehouse', 1150), // too far
      exp('c', '2026-10-05', 'Builders Warehouse', 1149.99), // wrong amount
    ])
    expect(c.map((x) => x.id)).toEqual(['a'])
    expect(c[0].score).toBeGreaterThanOrEqual(85)
  })
  it('ignores money in', () => {
    expect(expenseCandidates({ id: 't', date: '2026-10-05', description: '', amount: 100 }, [exp('a', '2026-10-05', 'X', 100)])).toEqual([])
  })
})

describe('reconcile', () => {
  it('auto-matches a unique strong candidate, suggests a weak one, leaves the rest', () => {
    const d = reconcile({
      transactions: [
        { id: 't1', date: '2026-10-05', description: 'POS PURCHASE BUILDERS WAREHOUSE', amount: -1150 },
        { id: 't2', date: '2026-10-07', description: 'UNKNOWN MERCHANT', amount: -230 },
        { id: 't3', date: '2026-10-07', description: 'SOMETHING ELSE', amount: -999 },
      ],
      expenses: [exp('e1', '2026-10-05', 'Builders Warehouse', 1150), exp('e2', '2026-10-04', 'Cashbuild', 230)],
      payments: [],
      invoices: [],
    })
    expect(d.map((x) => [x.transactionId, x.status, x.best?.id ?? null])).toEqual([
      ['t1', 'matched', 'e1'],
      ['t2', 'suggested', 'e2'],
      ['t3', 'unmatched', null],
    ])
  })

  it('never auto-matches one expense to two transactions', () => {
    const d = reconcile({
      transactions: [
        { id: 't1', date: '2026-10-05', description: 'BUILDERS WAREHOUSE', amount: -1150 },
        { id: 't2', date: '2026-10-06', description: 'BUILDERS WAREHOUSE', amount: -1150 },
      ],
      expenses: [exp('e1', '2026-10-05', 'Builders Warehouse', 1150)],
      payments: [],
      invoices: [],
    })
    expect(d.filter((x) => x.status === 'matched')).toHaveLength(1)
    expect(d.find((x) => x.transactionId === 't1')!.status).toBe('matched')
    expect(d.find((x) => x.transactionId === 't2')!.status).toBe('unmatched')
  })

  it('does not auto-match when two expenses are equally plausible', () => {
    const d = reconcile({
      transactions: [{ id: 't1', date: '2026-10-05', description: 'BUILDERS WAREHOUSE', amount: -1150 }],
      expenses: [exp('e1', '2026-10-05', 'Builders Warehouse', 1150), exp('e2', '2026-10-05', 'Builders Warehouse', 1150)],
      payments: [],
      invoices: [],
    })
    expect(d[0].status).toBe('suggested')
  })

  it('skips already-linked expenses', () => {
    const d = reconcile({
      transactions: [{ id: 't1', date: '2026-10-05', description: 'BUILDERS WAREHOUSE', amount: -1150 }],
      expenses: [exp('e1', '2026-10-05', 'Builders Warehouse', 1150)],
      payments: [],
      invoices: [],
      linkedExpenseIds: new Set(['e1']),
    })
    expect(d[0].status).toBe('unmatched')
  })
})

describe('incomeCandidates', () => {
  it('matches payments by amount and reference, and invoices by total/number', () => {
    const tx = { id: 't', date: '2026-10-02', description: 'ACB CREDIT SMITH INV-0004', amount: 25000 }
    const c = incomeCandidates(
      tx,
      [{ id: 'p1', date: '2026-10-01', amount: 25000, reference: 'INV-0004' }],
      [{ id: 'i1', number: 'INV-0004', issue_date: '2026-09-01', due_date: null, amount_excl: 21739.13, vat: 3260.87, status: 'sent' }],
    )
    expect(c[0]).toMatchObject({ kind: 'payment', id: 'p1' })
    expect(c[0].score).toBeGreaterThanOrEqual(90)
    expect(c.find((x) => x.kind === 'invoice')?.id).toBe('i1')
  })
})
