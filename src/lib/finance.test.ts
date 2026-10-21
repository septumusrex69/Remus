import { describe, expect, it } from 'vitest'
import { outstandingInvoices } from './finance'
import type { Invoice, InvoiceStatus, Payment } from '../types'

const inv = (id: string, status: InvoiceStatus, excl: number): Invoice => ({
  id,
  project_id: null,
  company_id: null,
  contact_id: null,
  number: id,
  issue_date: '2026-01-01',
  due_date: '2026-01-31',
  description: null,
  amount_excl: excl,
  vat: excl * 0.15,
  status,
  created_at: '2026-01-01T00:00:00Z',
})

const pay = (invoice_id: string, amount: number): Payment => ({
  id: `${invoice_id}-${amount}`,
  invoice_id,
  project_id: null,
  date: '2026-01-15',
  amount,
  method: 'eft',
  reference: null,
  created_at: '2026-01-15T00:00:00Z',
})

describe('outstandingInvoices', () => {
  it('counts issued invoices with a balance, including part-paid ones marked paid', () => {
    const invoices = [inv('A', 'sent', 1000), inv('B', 'paid', 1000), inv('C', 'paid', 1000), inv('D', 'draft', 1000), inv('E', 'cancelled', 1000), inv('F', 'overdue', 1000)]
    const payments = [pay('A', 500), pay('B', 1150), pay('C', 150)]
    const out = outstandingInvoices(invoices, payments, new Date(2026, 1, 15))
    expect(out.map((o) => o.invoice.id).sort()).toEqual(['A', 'C', 'F'])
    expect(out.find((o) => o.invoice.id === 'A')?.outstanding).toBe(650)
    expect(out.find((o) => o.invoice.id === 'C')?.outstanding).toBe(1000)
  })
})
