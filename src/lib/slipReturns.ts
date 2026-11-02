/**
 * RETURNS (Remus · Handover 8, 2 Nov 2026). Stephan: "you've bought ten paint strippers and you only used 5. Then
 * the other 5 should be returned. So we should have something for returning products as well."
 *
 * A return is logged against the slip the goods came on (which items, how many, what the store should give
 * back), waits on the "To take back" list, and once the store has refunded becomes a CREDIT: an expense with
 * negative amounts on the slip's job, stage and kind, so the job's cost drops by what came back. Migration 0036.
 */
import { round2 } from './format'
import { splitInclusive } from './quoteMath'
import type { Expense, ExpenseCategory, ID, ReceiptLineItem } from '../types'

export type ReturnStatus = 'to_return' | 'returned' | 'cancelled'

export interface ReturnItem {
  description: string
  quantity: number
  /** Price of one, incl. VAT. */
  unit_price: number | null
  /** quantity × unit_price, or typed when the slip gave no price. */
  amount: number
}

export interface SlipReturn {
  id: ID
  expense_id: ID | null
  project_id: ID | null
  stage_id: ID | null
  category: ExpenseCategory
  supplier: string | null
  receipt_number: string | null
  bought_on: string | null
  items: ReturnItem[]
  amount_incl: number
  status: ReturnStatus
  returned_on: string | null
  credit_number: string | null
  credit_amount_incl: number | null
  credit_path: string | null
  credit_expense_id: ID | null
  note: string | null
  created_by: ID | null
  created_at: string
  updated_at: string
}

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  to_return: 'To take back',
  returned: 'Returned',
  cancelled: 'Kept',
}

/** One line of the slip, as a choice on the return form: how many were bought, the price of one. */
export interface ReturnChoice {
  description: string
  bought: number
  unit_price: number | null
  /** How many go back (0 = this line stays). */
  qty: number
}

/** The slip's lines (what Claude read off it) as choices; the price of one from the line's amount and quantity. */
export function choicesFromSlip(lines: ReceiptLineItem[] | null | undefined): ReturnChoice[] {
  return (lines ?? [])
    .filter((l) => l.description?.trim())
    .map((l) => {
      const bought = l.quantity && l.quantity > 0 ? l.quantity : 1
      const unit = l.amount != null ? round2(l.amount / bought) : null
      return { description: l.description.trim(), bought, unit_price: unit, qty: 0 }
    })
}

/** The lines going back, priced. A line with no price counts R 0 until someone types the amount. */
export function itemsFromChoices(choices: ReturnChoice[]): ReturnItem[] {
  return choices
    .filter((c) => c.qty > 0)
    .map((c) => ({ description: c.description, quantity: c.qty, unit_price: c.unit_price, amount: round2((c.unit_price ?? 0) * c.qty) }))
}

export const itemsTotal = (items: ReturnItem[]) => round2(items.reduce((t, x) => t + (x.amount || 0), 0))

/** "5 × Paint stripper 5L, 2 × Brush" -- for the credit's description and the list. */
export function itemsLabel(items: ReturnItem[]): string {
  return items.map((x) => `${x.quantity} × ${x.description}`).join(', ')
}

/**
 * The credit written when the goods are back: negative amounts, on the slip's job, stage and kind. VAT comes
 * off in the same share as on the original slip (so a company not registered for VAT, whose slips carry no VAT
 * split, gets none either); without a slip, at the company's rate.
 */
export function creditFor(
  ret: Pick<SlipReturn, 'project_id' | 'stage_id' | 'category' | 'supplier' | 'receipt_number' | 'items'>,
  credit: { date: string; amount_incl: number; credit_number?: string | null; credit_path?: string | null },
  slip: Pick<Expense, 'amount_excl' | 'vat'> | null,
  vatRate: number,
): Omit<Expense, 'id' | 'created_at'> {
  const incl = round2(Math.abs(credit.amount_incl))
  const slipIncl = slip ? round2(slip.amount_excl + slip.vat) : 0
  const vat = slip && slipIncl > 0 ? round2((incl * slip.vat) / slipIncl) : splitInclusive(incl, vatRate).vat
  const what = itemsLabel(ret.items)
  return {
    project_id: ret.project_id,
    stage_id: ret.project_id ? ret.stage_id : null,
    date: credit.date,
    category: ret.category,
    supplier: ret.supplier,
    description: `Return${what ? `: ${what}` : ''}${ret.receipt_number ? ` · slip ${ret.receipt_number}` : ''}`,
    amount_excl: -round2(incl - vat),
    vat: -vat,
    receipt_url: null,
    receipt_path: credit.credit_path ?? null,
    receipt_number: credit.credit_number || null,
    ai_extracted: null,
    ai_suggestion: null,
    source: 'receipt',
    paid: true,
  }
}

/** What is waiting to go back: how many returns, and how much money is still at the stores. */
export function openSummary(rows: Pick<SlipReturn, 'status' | 'amount_incl'>[]): { count: number; amount: number } {
  const open = rows.filter((r) => r.status === 'to_return')
  return { count: open.length, amount: round2(open.reduce((t, r) => t + r.amount_incl, 0)) }
}
