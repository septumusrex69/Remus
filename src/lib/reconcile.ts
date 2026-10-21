/**
 * Bank reconciliation matching engine. Pure: takes plain rows, returns decisions. No I/O.
 *
 * Money out  -> expenses with the same VAT-inclusive amount within ±5 days, boosted by how well
 *               the expense supplier matches the bank description ("BUILDERS WAREHOUSE" vs
 *               "POS PURCHASE BWH MIDRAND").
 * Money in   -> payments with the same amount within ±7 days, then open invoices whose
 *               VAT-inclusive total matches, boosted when the invoice number or reference
 *               appears in the description.
 *
 * Scores are 0..100: amount match 50 + date closeness up to 20 + name/reference up to 30.
 * A unique best candidate scoring >= AUTO_MATCH_SCORE (and clearly ahead of the runner-up) is
 * auto-matched; anything >= SUGGEST_SCORE is suggested for a person to confirm.
 */

export const AUTO_MATCH_SCORE = 85
export const SUGGEST_SCORE = 50
export const EXPENSE_DAY_WINDOW = 5
export const PAYMENT_DAY_WINDOW = 7

export interface TxInput {
  id: string
  date: string // yyyy-mm-dd
  description: string
  reference?: string | null
  amount: number // negative = money out
}

export interface ExpenseInput {
  id: string
  date: string
  supplier: string | null
  description?: string | null
  amount_excl: number
  vat: number
  receipt_number?: string | null
}

export interface PaymentInput {
  id: string
  date: string
  amount: number
  reference: string | null
}

export interface InvoiceInput {
  id: string
  number: string | null
  issue_date: string
  due_date: string | null
  amount_excl: number
  vat: number
  status: string
  client_name?: string | null
}

export type CandidateKind = 'expense' | 'payment' | 'invoice'

export interface Candidate {
  kind: CandidateKind
  id: string
  score: number
  reasons: string[]
}

export interface Decision {
  transactionId: string
  status: 'matched' | 'suggested' | 'unmatched'
  best: Candidate | null
  candidates: Candidate[]
}

// ---------- Text helpers ----------

/** Words that appear in card/EFT descriptions and say nothing about who was paid. */
const NOISE = new Set([
  'POS', 'PURCHASE', 'PURCH', 'CARD', 'DEBIT', 'CREDIT', 'ORDER', 'EFT', 'PMT', 'PAYMENT', 'PAYMT', 'FROM', 'TO',
  'INT', 'INTERNET', 'BANKING', 'MAGTAPE', 'IB', 'ACB', 'SETTLEMENT', 'FEE', 'FEES', 'TRANSFER', 'TRF', 'DR', 'CR',
  'SA', 'ZA', 'RSA', 'PTY', 'LTD', 'CC', 'THE', 'AND', 'OF', 'CO', 'INC', 'GROUP', 'STORE', 'STORES', 'BRANCH',
  'RECURRING', 'DEBICHECK', 'CHEQUE', 'SPEEDPOINT', 'CONTACTLESS', 'TAP', 'ZAR', 'REF', 'REFERENCE',
])

export function tokens(s: string | null | undefined): string[] {
  return (s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !NOISE.has(t) && !/^\d+$/.test(t))
}

function consonants(s: string): string {
  return s[0] + s.slice(1).replace(/[AEIOU]/g, '')
}

function bigrams(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

/** Sørensen–Dice on character bigrams, 0..1. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.length || !B.length) return 0
  const counts = new Map<string, number>()
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1)
  let hits = 0
  for (const g of B) {
    const c = counts.get(g) ?? 0
    if (c > 0) {
      hits++
      counts.set(g, c - 1)
    }
  }
  return (2 * hits) / (A.length + B.length)
}

/**
 * How well a supplier name matches a bank description, 0..1. Handles:
 *  - whole words      "BUILDERS WAREHOUSE"  vs "BUILDERS WAREHOUSE MIDRAND"  -> 1
 *  - acronyms         "Builders Warehouse"  vs "BWH MIDRAND" / "BW 1234"      -> ~0.7
 *  - abbreviations    "Cashbuild"           vs "CASHBLD"                      -> ~0.7
 *  - near spellings   via bigram similarity.
 */
export function supplierSimilarity(supplier: string | null | undefined, description: string): number {
  const sTok = tokens(supplier)
  const dTok = tokens(description)
  if (!sTok.length || !dTok.length) return 0
  const dJoined = dTok.join('')

  // 1. Supplier words present in the description.
  const wordHits = sTok.filter((t) => dTok.some((d) => d === t || (t.length >= 4 && (d.startsWith(t) || t.startsWith(d) && d.length >= 4))))
  let score = wordHits.length / sTok.length

  // 2. Whole supplier name squashed inside the description ("BUILDERSWAREHOUSE", "CASHBUILD").
  const sJoined = sTok.join('')
  if (sJoined.length >= 4 && dJoined.includes(sJoined)) score = Math.max(score, 1)

  // 3. Acronym: initials of a multi-word supplier at the start of a short description token.
  if (sTok.length >= 2) {
    const initials = sTok.map((t) => t[0]).join('')
    for (const d of dTok) {
      if (d.length <= initials.length + 2 && d.startsWith(initials)) score = Math.max(score, 0.7)
      // "BWH" for Builders WareHouse: initials plus a consonant from the last word.
      else if (d.length <= 4 && d[0] === initials[0] && d.split('').every((ch) => sJoined.includes(ch)) && d.includes(initials[1]))
        score = Math.max(score, 0.65)
    }
  }

  // 4. Consonant abbreviation ("CASHBLD" ~ "CASHBUILD", "BLDRS" ~ "BUILDERS").
  for (const t of sTok) {
    if (t.length < 5) continue
    const c = consonants(t)
    if (dTok.some((d) => d.length >= 4 && (consonants(d) === c || d === c || dice(consonants(d), c) >= 0.8))) score = Math.max(score, 0.7)
  }

  // 5. Fuzzy fallback on the squashed strings.
  score = Math.max(score, dice(sJoined, dJoined.slice(0, sJoined.length + 4)) * 0.8)
  return Math.min(1, score)
}

// ---------- Dates ----------

export function daysBetween(a: string, b: string): number {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.round(Math.abs(da - db) / 86_400_000)
}

function cents(n: number): number {
  return Math.round(Math.abs(n) * 100)
}

// ---------- Candidate scoring ----------

export function expenseCandidates(tx: TxInput, expenses: ExpenseInput[]): Candidate[] {
  if (tx.amount >= 0) return []
  const want = cents(tx.amount)
  const out: Candidate[] = []
  for (const e of expenses) {
    if (cents(e.amount_excl + e.vat) !== want) continue
    const days = daysBetween(tx.date, e.date)
    if (days > EXPENSE_DAY_WINDOW) continue
    const reasons = ['Same amount']
    let score = 50 + 20 * (1 - days / EXPENSE_DAY_WINDOW)
    reasons.push(days === 0 ? 'Same day' : `${days} day${days === 1 ? '' : 's'} apart`)
    const sim = supplierSimilarity(e.supplier, `${tx.description} ${tx.reference ?? ''}`)
    if (sim > 0.3) {
      score += 30 * sim
      reasons.push(`Supplier looks like "${e.supplier}"`)
    }
    if (e.receipt_number && `${tx.description} ${tx.reference ?? ''}`.toUpperCase().includes(e.receipt_number.toUpperCase())) {
      score = Math.max(score, 95)
      reasons.push('Slip number in description')
    }
    out.push({ kind: 'expense', id: e.id, score: Math.round(Math.min(100, score)), reasons })
  }
  return out.sort((a, b) => b.score - a.score)
}

function referenceHit(haystack: string, needle: string | null | undefined): boolean {
  if (!needle) return false
  const n = needle.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (n.length < 3) return false
  return haystack.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(n)
}

export function incomeCandidates(tx: TxInput, payments: PaymentInput[], invoices: InvoiceInput[]): Candidate[] {
  if (tx.amount <= 0) return []
  const want = cents(tx.amount)
  const text = `${tx.description} ${tx.reference ?? ''}`
  const out: Candidate[] = []
  for (const p of payments) {
    if (cents(p.amount) !== want) continue
    const days = daysBetween(tx.date, p.date)
    if (days > PAYMENT_DAY_WINDOW) continue
    let score = 50 + 20 * (1 - days / PAYMENT_DAY_WINDOW)
    const reasons = ['Same amount', days === 0 ? 'Same day' : `${days} days apart`]
    if (referenceHit(text, p.reference)) {
      score += 30
      reasons.push('Reference matches')
    }
    out.push({ kind: 'payment', id: p.id, score: Math.round(Math.min(100, score)), reasons })
  }
  for (const inv of invoices) {
    if (inv.status === 'paid' || inv.status === 'cancelled' || inv.status === 'draft') continue
    const refHit = referenceHit(text, inv.number)
    const amountHit = cents(inv.amount_excl + inv.vat) === want
    if (!amountHit && !refHit) continue
    // An invoice is a weaker candidate than a recorded payment: confirming it records a payment.
    let score = amountHit ? 45 : 25
    const reasons = [amountHit ? 'Invoice total matches' : 'Invoice number in description']
    if (amountHit && refHit) {
      score += 30
      reasons.push('Invoice number in description')
    }
    if (inv.client_name && supplierSimilarity(inv.client_name, text) > 0.5) {
      score += 10
      reasons.push(`Payer looks like "${inv.client_name}"`)
    }
    out.push({ kind: 'invoice', id: inv.id, score: Math.min(100, score), reasons })
  }
  return out.sort((a, b) => b.score - a.score)
}

// ---------- Whole-statement pass ----------

export interface ReconcileInput {
  transactions: TxInput[]
  expenses: ExpenseInput[]
  payments: PaymentInput[]
  invoices: InvoiceInput[]
  /** Expenses/payments already linked to some bank transaction; never offered again. */
  linkedExpenseIds?: Set<string>
  linkedPaymentIds?: Set<string>
}

/**
 * Decides every transaction. Auto-matches are assigned greedily from the highest score down so
 * one expense is never auto-matched to two bank lines; a transaction whose best candidate was
 * taken falls back to 'suggested' or 'unmatched'.
 */
export function reconcile(input: ReconcileInput): Decision[] {
  const linkedE = new Set(input.linkedExpenseIds ?? [])
  const linkedP = new Set(input.linkedPaymentIds ?? [])
  const expenses = input.expenses.filter((e) => !linkedE.has(e.id))
  const payments = input.payments.filter((p) => !linkedP.has(p.id))

  const scored = input.transactions.map((tx) => ({
    tx,
    candidates: tx.amount < 0 ? expenseCandidates(tx, expenses) : incomeCandidates(tx, payments, input.invoices),
  }))

  const taken = new Set<string>()
  const decisions = new Map<string, Decision>()

  // Pass 1: auto-match, best scores first.
  const autos = scored
    .filter(({ candidates }) => {
      const [a, b] = candidates
      return a && a.kind !== 'invoice' && a.score >= AUTO_MATCH_SCORE && (!b || a.score - b.score >= 15)
    })
    .sort((x, y) => y.candidates[0].score - x.candidates[0].score)
  for (const { tx, candidates } of autos) {
    const key = `${candidates[0].kind}:${candidates[0].id}`
    if (taken.has(key)) continue
    taken.add(key)
    decisions.set(tx.id, { transactionId: tx.id, status: 'matched', best: candidates[0], candidates })
  }

  // Pass 2: everything else is suggested or unmatched.
  for (const { tx, candidates } of scored) {
    if (decisions.has(tx.id)) continue
    const open = candidates.filter((c) => c.kind === 'invoice' || !taken.has(`${c.kind}:${c.id}`))
    const best = open[0] ?? null
    decisions.set(tx.id, {
      transactionId: tx.id,
      status: best && best.score >= SUGGEST_SCORE ? 'suggested' : 'unmatched',
      best,
      candidates: open,
    })
  }
  return input.transactions.map((t) => decisions.get(t.id)!)
}
