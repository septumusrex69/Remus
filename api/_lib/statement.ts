/**
 * A CLIENT'S STATEMENT OF ACCOUNT, WORKED OUT (Remus · Handover 8). Stephan, 7 Nov: "Definitely a statement of
 * account."
 *
 * Copied from Raptor's statement (src/lib/accountBalance.ts buildStatement + accountSummaryLetter.ts
 * statementOfAccount): every movement in date order with a running balance, the balance brought forward, how the
 * balance is made up, and what is owed. Raptor's is a debtor's account (capital, interest, Annexure B fees); a
 * builder's client has only two kinds of movement, so what is left is:
 *
 *   DEBIT   an invoice that went out (not a draft, not cancelled), its total incl. VAT, on its issue date;
 *   CREDIT  a payment received, on its date: paid against one of the client's invoices, or paid on one of the
 *           client's jobs without an invoice (it still reduces what they owe).
 *
 * PURE, so the PDF (api/_lib/statementPdf.ts) and the check (src/lib/statement.test.ts) run the same lines, and so
 * the ageing here agrees with Finance's (src/lib/finance.ts ageingBucket; the test holds them together, because
 * api/ cannot import src/).
 */

export interface StatementInvoice {
  id: string
  number: string | null
  issue_date: string
  due_date: string | null
  description: string | null
  amount_excl: number
  vat: number
  status: string
}

export interface StatementPayment {
  id: string
  invoice_id: string | null
  date: string
  amount: number
  method: string | null
  reference: string | null
}

export interface StatementLine {
  date: string
  detail: string
  debit: number
  credit: number
  balance: number
}

/** Finance's buckets (src/lib/finance.ts AGEING_BUCKETS), the same words. */
export const STATEMENT_BUCKETS = ['Current', '1–30 days', '31–60 days', '61–90 days', '90+ days'] as const
export type StatementBucket = (typeof STATEMENT_BUCKETS)[number]

export interface Statement {
  /** yyyy-mm-dd, or null for "from the first invoice". */
  from: string | null
  to: string
  /** The day the figures are struck: the period's end, or today when the period runs on past today. */
  asAt: string
  opening: number
  invoiced: number
  received: number
  closing: number
  lines: StatementLine[]
  /** What is owed, by how late it is; adds up to `due`. */
  ageing: { bucket: StatementBucket; amount: number }[]
  /** What the client owes as at `asAt`; 0 when they are in credit. */
  due: number
  /** What they have paid beyond what was invoiced, as at `asAt`; 0 when they owe. */
  inCredit: number
}

/** Cents, half away from zero, like src/lib/format.ts round2. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n
  const cents = Math.round(Number((Math.abs(n) * 100).toPrecision(15)))
  return (Math.sign(n) * cents) / 100 || 0
}

export function ageingBucketFor(daysOverdue: number): StatementBucket {
  if (daysOverdue <= 0) return 'Current'
  if (daysOverdue <= 30) return '1–30 days'
  if (daysOverdue <= 60) return '31–60 days'
  if (daysOverdue <= 90) return '61–90 days'
  return '90+ days'
}

/** Whole days from a to b (both yyyy-mm-dd), as date-fns differenceInCalendarDays does. */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((t(b) - t(a)) / 86_400_000)
}

const counts = (i: StatementInvoice) => i.status !== 'draft' && i.status !== 'cancelled'
const totalOf = (i: StatementInvoice) => round2(Number(i.amount_excl) + Number(i.vat))
const METHOD: Record<string, string> = { eft: 'EFT', cash: 'cash', card: 'card', cheque: 'cheque', other: '' }

export function buildStatement(input: {
  invoices: StatementInvoice[]
  /** Every payment of this client's (against its invoices, or on its jobs with no invoice). */
  payments: StatementPayment[]
  from: string | null
  to: string
  today: string
}): Statement {
  const asAt = input.to < input.today ? input.to : input.today
  const invoices = input.invoices.filter(counts)
  const numberOf = new Map(invoices.map((i) => [i.id, i.number]))

  /* ---- the balance brought forward: everything before the period ---- */
  const before = (d: string) => input.from !== null && d < input.from
  const opening = round2(
    invoices.filter((i) => before(i.issue_date)).reduce((s, i) => s + totalOf(i), 0)
    - input.payments.filter((p) => before(p.date)).reduce((s, p) => s + Number(p.amount), 0),
  )

  /* ---- every movement in the period, oldest first; on one day the invoice before the payment against it ---- */
  const inPeriod = (d: string) => !before(d) && d <= input.to
  type Move = { date: string; order: number; detail: string; debit: number; credit: number }
  const moves: Move[] = [
    ...invoices.filter((i) => inPeriod(i.issue_date)).map((i) => ({
      date: i.issue_date, order: 0,
      detail: `Invoice ${i.number ?? ''}${i.description?.trim() ? ` · ${i.description.trim()}` : ''}`.trim(),
      debit: totalOf(i), credit: 0,
    })),
    ...input.payments.filter((p) => inPeriod(p.date)).map((p) => {
      const how = METHOD[p.method ?? ''] ?? ''
      const against = p.invoice_id ? numberOf.get(p.invoice_id) : null
      const parts = [`Payment received${how ? ` (${how})` : ''}`, against ? `against ${against}` : null, p.reference?.trim() ? `ref ${p.reference.trim()}` : null]
      return { date: p.date, order: 1, detail: parts.filter(Boolean).join(' · '), debit: 0, credit: round2(Number(p.amount)) }
    }),
  ].sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1))

  let running = opening
  const lines: StatementLine[] = moves.map((m) => {
    running = round2(running + m.debit - m.credit)
    return { date: m.date, detail: m.detail, debit: m.debit, credit: m.credit, balance: running }
  })
  const invoiced = round2(moves.reduce((s, m) => s + m.debit, 0))
  const received = round2(moves.reduce((s, m) => s + m.credit, 0))
  const closing = round2(opening + invoiced - received)

  /* ---- the ageing, as at asAt: each invoice less what was paid against it; then any payment not against an
     invoice is taken off the OLDEST first, so the buckets add up to the balance ---- */
  const upTo = (d: string) => d <= asAt
  const paidAgainst = new Map<string, number>()
  let loose = 0
  for (const p of input.payments.filter((x) => upTo(x.date))) {
    if (p.invoice_id && numberOf.has(p.invoice_id)) paidAgainst.set(p.invoice_id, (paidAgainst.get(p.invoice_id) ?? 0) + Number(p.amount))
    else loose += Number(p.amount)
  }
  const open = invoices
    .filter((i) => upTo(i.issue_date))
    .map((i) => ({ owed: round2(totalOf(i) - (paidAgainst.get(i.id) ?? 0)), days: daysBetween(i.due_date ?? i.issue_date, asAt) }))
  /* An invoice paid beyond its total gives the rest back as a loose credit. */
  for (const o of open) if (o.owed < 0) { loose -= o.owed; o.owed = 0 }
  open.sort((a, b) => b.days - a.days)
  for (const o of open) {
    const take = Math.min(o.owed, loose)
    o.owed = round2(o.owed - take)
    loose = round2(loose - take)
  }
  const ageing = STATEMENT_BUCKETS.map((bucket) => ({
    bucket,
    amount: round2(open.filter((o) => ageingBucketFor(o.days) === bucket).reduce((s, o) => s + o.owed, 0)),
  }))
  const due = round2(ageing.reduce((s, a) => s + a.amount, 0))
  return { from: input.from, to: input.to, asAt, opening, invoiced, received, closing, lines, ageing, due, inCredit: round2(Math.max(0, loose)) }
}

/**
 * WHOSE MONEY IT IS: the client's invoices (company or private client, as the client page lists them), and the
 * payments against those invoices or on the client's jobs with no invoice. One rule, for the PDF and the email.
 */
export function clientPayments<P extends StatementPayment & { project_id: string | null }>(
  payments: P[], invoiceIds: Set<string>, projectIds: Set<string>,
): P[] {
  return payments.filter((p) => (p.invoice_id ? invoiceIds.has(p.invoice_id) : !!p.project_id && projectIds.has(p.project_id)))
}

/** "Statement-Acme-Builders-2026-11-07.pdf" */
export function statementFileName(clientName: string, asAt: string): string {
  const safe = clientName.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'client'
  return `Statement-${safe}-${asAt}.pdf`
}
