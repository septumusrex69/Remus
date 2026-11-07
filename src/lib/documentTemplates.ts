/**
 * THE LIBRARY'S WORDS (Remus · Handover 8, copied from Raptor's src/lib/messageTemplates.ts and adapted to a
 * builder). Stephan, 7 Nov, on Raptor's Library: "we can start with pretty much all of that."
 *
 * PURE, so a test can hold it: the kinds of document, the merge fields a template may use, filling them in
 * from a project, its client, its quote, a variation or an invoice, and reading the small markup the Library
 * writes in. The database half is lib/documentsApi.ts; the PDF is drawn by api/_lib/documentPdf.ts, which reads
 * the same markup (api/ cannot import from src/, so the few lines that parse it exist twice -- keep them alike).
 *
 * THE MARKUP: "# " a heading, "## " a smaller heading, "- " a bullet, **bold** inside a line, a blank line
 * for a gap; every other line is printed as its own line (addresses keep their shape).
 */

export const DOC_KINDS = ['contract', 'site_instruction', 'variation_order', 'completion_certificate', 'letter', 'payment_reminder', 'other'] as const
export type DocKind = (typeof DOC_KINDS)[number]

export const DOC_KIND: Record<DocKind, { label: string; plural: string }> = {
  contract: { label: 'Contract', plural: 'Contracts' },
  site_instruction: { label: 'Site instruction', plural: 'Site instructions' },
  variation_order: { label: 'Variation order', plural: 'Variation orders' },
  completion_certificate: { label: 'Completion certificate', plural: 'Completion certificates' },
  letter: { label: 'Letter', plural: 'Letters' },
  payment_reminder: { label: 'Payment reminder', plural: 'Payment reminders' },
  other: { label: 'Other', plural: 'Other documents' },
}

/** The kinds a site manager may see (0046's policy): they carry no rand amounts. */
export const MONEY_FREE_KINDS: DocKind[] = ['site_instruction', 'completion_certificate']

export interface MergeField { key: string; label: string; group: 'Company' | 'Client' | 'Project' | 'Quote' | 'Variation' | 'Invoice' | 'Other'; example: string }

/** Every field a template may ask for. A field not on this list has nothing behind it. */
export const MERGE_FIELDS: MergeField[] = [
  { key: 'today', label: "Today's date", group: 'Other', example: '7 Nov 2026' },
  { key: 'sender_name', label: 'Your name', group: 'Other', example: 'Stephan' },
  { key: 'company_name', label: 'Company name', group: 'Company', example: 'Urban Haus Construction' },
  { key: 'company_address', label: 'Company address', group: 'Company', example: '1 Main Road, Pretoria' },
  { key: 'company_phone', label: 'Company phone', group: 'Company', example: '012 345 6789' },
  { key: 'company_email', label: 'Company email', group: 'Company', example: 'info@urbanhausgroup.co.za' },
  { key: 'company_reg_no', label: 'Registration number', group: 'Company', example: '2020/123456/07' },
  { key: 'company_vat_no', label: 'VAT number', group: 'Company', example: '4123456789' },
  { key: 'bank_details', label: 'Banking details', group: 'Company', example: 'FNB · Acc 123 456 789 · Branch 250655' },
  { key: 'client_name', label: 'Client name', group: 'Client', example: 'Thandi Mokoena' },
  { key: 'client_address', label: 'Client address', group: 'Client', example: '2 Client Road, Pretoria' },
  { key: 'client_email', label: 'Client email', group: 'Client', example: 'thandi@example.com' },
  { key: 'client_phone', label: 'Client phone', group: 'Client', example: '082 000 0000' },
  { key: 'project_name', label: 'Project name', group: 'Project', example: 'Kitchen at 2 Client Road' },
  { key: 'project_code', label: 'Project code', group: 'Project', example: 'UH-001' },
  { key: 'site_address', label: 'Site address', group: 'Project', example: '2 Client Road, Pretoria' },
  { key: 'start_date', label: 'Start date', group: 'Project', example: '5 Oct 2026' },
  { key: 'end_date', label: 'Completion date', group: 'Project', example: '15 Dec 2026' },
  { key: 'quote_number', label: 'Quote number', group: 'Quote', example: 'Q0001' },
  { key: 'quote_title', label: 'Quote title', group: 'Quote', example: 'Kitchen renovation' },
  { key: 'quote_date', label: 'Quote date', group: 'Quote', example: '20 Sep 2026' },
  { key: 'contract_sum', label: 'Contract sum incl. VAT', group: 'Quote', example: 'R 345 000.00' },
  { key: 'contract_sum_excl', label: 'Contract sum excl. VAT', group: 'Quote', example: 'R 300 000.00' },
  { key: 'vat_amount', label: 'VAT on the contract sum', group: 'Quote', example: 'R 45 000.00' },
  { key: 'deposit_pct', label: 'Deposit %', group: 'Quote', example: '50' },
  { key: 'deposit_amount', label: 'Deposit amount', group: 'Quote', example: 'R 172 500.00' },
  { key: 'variation_description', label: 'Variation: what changes', group: 'Variation', example: 'Extra window in bedroom 2' },
  { key: 'variation_amount', label: 'Variation amount excl. VAT', group: 'Variation', example: 'R 8 500.00' },
  { key: 'variation_amount_incl', label: 'Variation amount incl. VAT', group: 'Variation', example: 'R 9 775.00' },
  { key: 'variation_date', label: 'Variation date', group: 'Variation', example: '1 Nov 2026' },
  { key: 'invoice_number', label: 'Invoice number', group: 'Invoice', example: 'INV0003' },
  { key: 'invoice_date', label: 'Invoice date', group: 'Invoice', example: '1 Nov 2026' },
  { key: 'invoice_due_date', label: 'Invoice due date', group: 'Invoice', example: '8 Nov 2026' },
  { key: 'invoice_amount', label: 'Invoice amount incl. VAT', group: 'Invoice', example: 'R 57 500.00' },
  { key: 'amount_outstanding', label: 'Amount still owed on it', group: 'Invoice', example: 'R 27 500.00' },
]

const KNOWN = new Set(MERGE_FIELDS.map((f) => f.key))
const fieldPattern = () => /\{\{\s*([a-z0-9_]+)\s*\}\}/g

/** The fields a piece of wording asks for, in the order they first appear. */
export function fieldsUsed(...parts: (string | null | undefined)[]): string[] {
  const seen: string[] = []
  for (const part of parts) for (const m of (part ?? '').matchAll(fieldPattern())) if (!seen.includes(m[1])) seen.push(m[1])
  return seen
}

/** Fields asked for that Remus cannot fill: the braces would go out as they are. */
export function unknownFields(...parts: (string | null | undefined)[]): string[] {
  return fieldsUsed(...parts).filter((k) => !KNOWN.has(k))
}

/** What a gap looks like in a document whose field had no value: a line to fill in by hand. */
export const GAP = '__________'

/**
 * Fill the fields in. A field with no value becomes a line to fill in (GAP) and is reported in `missing`, so the
 * person making the document sees what to type before it goes out (Raptor refuses to SEND with gaps; a builder's
 * document is edited after it is made, so here it is shown, not refused).
 */
export function renderTemplate(template: string | null | undefined, values: Partial<Record<string, string | null>>): { text: string; missing: string[] } {
  const missing: string[] = []
  const text = (template ?? '').replace(fieldPattern(), (_whole, key: string) => {
    const v = values[key]
    if (v === undefined || v === null || !String(v).trim()) {
      if (!missing.includes(key)) missing.push(key)
      return GAP
    }
    return String(v)
  })
  return { text, missing }
}

export const sampleValues = (): Record<string, string> => Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.example]))

export const fieldLabel = (key: string) => MERGE_FIELDS.find((f) => f.key === key)?.label ?? key

/* ------------------------------------------------------------------ filling them from Remus's records */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function longDate(ymd: string | null | undefined): string {
  if (!ymd) return ''
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ''
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`
}

/** Rand as the quote PDF writes it: R 1 234.50 (api/_lib/quotePdf.ts zar). */
export function rand(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  const [int, frac] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}R ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac}`
}

export interface MergeContext {
  today: string
  senderName?: string | null
  company?: { name?: string | null; address?: string | null; phone?: string | null; email?: string | null; reg_no?: string | null; vat_no?: string | null; bank_details?: string | null; vat_rate?: number | null; vat_registered?: boolean | null } | null
  client?: { name?: string | null; address?: string | null; email?: string | null; phone?: string | null } | null
  project?: { name?: string | null; code?: string | null; site_address?: string | null; start_date?: string | null; end_date?: string | null } | null
  quote?: { number?: string | null; title?: string | null; issue_date?: string | null; deposit_pct?: number | null; site_address?: string | null } | null
  quoteTotals?: { total_excl: number; vat: number; total_incl: number } | null
  variation?: { description: string; amount_excl: number; date: string } | null
  invoice?: { number?: string | null; issue_date?: string | null; due_date?: string | null; amount_excl: number; vat: number } | null
  /** Paid so far on the invoice. */
  invoicePaid?: number | null
}

/** Every field's value from the records chosen. Empty where Remus does not know it. */
export function mergeValues(c: MergeContext): Record<string, string> {
  const vatRate = c.company?.vat_registered === false ? 0 : Number(c.company?.vat_rate ?? 15)
  const t = c.quoteTotals
  const deposit = t && c.quote?.deposit_pct != null ? Math.round(t.total_incl * Number(c.quote.deposit_pct)) / 100 : null
  const invTotal = c.invoice ? Math.round((c.invoice.amount_excl + c.invoice.vat) * 100) / 100 : null
  const v = c.variation
  return {
    today: longDate(c.today),
    sender_name: c.senderName ?? '',
    company_name: c.company?.name ?? '',
    company_address: (c.company?.address ?? '').replace(/\s*\n\s*/g, ', '),
    company_phone: c.company?.phone ?? '',
    company_email: c.company?.email ?? '',
    company_reg_no: c.company?.reg_no ?? '',
    company_vat_no: c.company?.vat_no ?? '',
    bank_details: c.company?.bank_details ?? '',
    client_name: c.client?.name ?? '',
    client_address: (c.client?.address ?? '').replace(/\s*\n\s*/g, ', '),
    client_email: c.client?.email ?? '',
    client_phone: c.client?.phone ?? '',
    project_name: c.project?.name ?? '',
    project_code: c.project?.code ?? '',
    site_address: c.project?.site_address ?? c.quote?.site_address ?? '',
    start_date: longDate(c.project?.start_date),
    end_date: longDate(c.project?.end_date),
    quote_number: c.quote?.number ?? '',
    quote_title: c.quote?.title ?? '',
    quote_date: longDate(c.quote?.issue_date),
    contract_sum: t ? rand(t.total_incl) : '',
    contract_sum_excl: t ? rand(t.total_excl) : '',
    vat_amount: t ? rand(t.vat) : '',
    deposit_pct: c.quote?.deposit_pct != null ? String(Number(c.quote.deposit_pct)) : '',
    deposit_amount: deposit != null ? rand(deposit) : '',
    variation_description: v?.description ?? '',
    variation_amount: v ? rand(v.amount_excl) : '',
    variation_amount_incl: v ? rand(Math.round(v.amount_excl * (1 + vatRate / 100) * 100) / 100) : '',
    variation_date: longDate(v?.date),
    invoice_number: c.invoice?.number ?? '',
    invoice_date: longDate(c.invoice?.issue_date),
    invoice_due_date: longDate(c.invoice?.due_date),
    invoice_amount: invTotal != null ? rand(invTotal) : '',
    amount_outstanding: invTotal != null ? rand(Math.max(0, invTotal - Number(c.invoicePaid ?? 0))) : '',
  }
}

/** Which records the person should be asked to pick, from the fields the template uses. */
export function needs(body: string, subject?: string | null): { quote: boolean; variation: boolean; invoice: boolean } {
  const used = fieldsUsed(body, subject)
  const group = (g: MergeField['group']) => used.some((k) => MERGE_FIELDS.find((f) => f.key === k)?.group === g)
  return { quote: group('Quote'), variation: group('Variation'), invoice: group('Invoice') }
}

/* ------------------------------------------------------------------ the markup, read for the screen */

type Runs = { text: string; bold: boolean }[]
export type DocBlock =
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'li'; runs: Runs }
  | { type: 'line'; runs: Runs }
  | { type: 'gap' }

/** **bold** runs inside a line. An unclosed ** makes the rest bold, as the PDF does. */
export function inlineRuns(line: string): { text: string; bold: boolean }[] {
  return line.split('**').map((text, i) => ({ text, bold: i % 2 === 1 })).filter((r) => r.text)
}

export function parseDocument(text: string): DocBlock[] {
  const out: DocBlock[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) { if (out.length && out[out.length - 1].type !== 'gap') out.push({ type: 'gap' }); continue }
    if (line.startsWith('# ')) out.push({ type: 'h1', text: line.slice(2).replace(/\*\*/g, '') })
    else if (line.startsWith('## ')) out.push({ type: 'h2', text: line.slice(3).replace(/\*\*/g, '') })
    else if (/^[-*] /.test(line)) out.push({ type: 'li', runs: inlineRuns(line.slice(2)) })
    else out.push({ type: 'line', runs: inlineRuns(line) })
  }
  return out
}
