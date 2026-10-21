import { differenceInCalendarDays, parseISO } from 'date-fns'
import { round2 } from './format'
import type { Invoice, Payment } from '../types'

export function invoiceTotal(i: Pick<Invoice, 'amount_excl' | 'vat'>): number {
  return round2(Number(i.amount_excl) + Number(i.vat))
}

/** Paid against each invoice (payments linked by invoice_id). */
export function paidByInvoice(payments: Payment[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of payments) if (p.invoice_id) m.set(p.invoice_id, round2((m.get(p.invoice_id) ?? 0) + Number(p.amount)))
  return m
}

export interface OutstandingInvoice {
  invoice: Invoice
  total: number
  paid: number
  outstanding: number
  daysOverdue: number
  bucket: AgeingBucket
}

export const AGEING_BUCKETS = ['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days'] as const
export type AgeingBucket = (typeof AGEING_BUCKETS)[number]

export function ageingBucket(daysOverdue: number): AgeingBucket {
  if (daysOverdue <= 0) return 'Current'
  if (daysOverdue <= 30) return '1–30 days'
  if (daysOverdue <= 60) return '31–60 days'
  if (daysOverdue <= 90) return '61–90 days'
  return '90+ days'
}

/**
 * Invoices with a balance still owing: anything issued (not draft or cancelled) whose linked
 * payments don't cover the incl.-VAT total. That includes an invoice marked 'paid' that was
 * only part paid. `payments` should be all payments, not just a period's.
 */
export function outstandingInvoices(invoices: Invoice[], payments: Payment[], today = new Date()): OutstandingInvoice[] {
  const paid = paidByInvoice(payments)
  return invoices
    .filter((i) => i.status !== 'draft' && i.status !== 'cancelled')
    .map((invoice) => {
      const total = invoiceTotal(invoice)
      const p = paid.get(invoice.id) ?? 0
      const due = invoice.due_date ?? invoice.issue_date
      const daysOverdue = differenceInCalendarDays(today, parseISO(due))
      return { invoice, total, paid: p, outstanding: round2(total - p), daysOverdue, bucket: ageingBucket(daysOverdue) }
    })
    .filter((x) => x.outstanding > 0.005)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
}
