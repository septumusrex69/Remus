/**
 * Typed data access for Remus. Every page goes through here, never `supabase.from` directly, so
 * the queries are in one place when this is lifted into Raptor.
 *
 * Functions throw on error (with the PostgREST message); pages catch and show it.
 */
import { supabase, QUOTE_FILES_BUCKET, RECEIPTS_BUCKET } from './supabase'
import { quoteTotals } from './quoteMath'
import type {
  Activity,
  BankAccount,
  BankStatement,
  BankTransaction,
  Company,
  CompanySettings,
  Contact,
  DiaryEvent,
  EmailStatus,
  Expense,
  ExtractResponse,
  ID,
  Invoice,
  Payment,
  Profile,
  Project,
  ProjectFinancials,
  Quote,
  QuoteAttachment,
  QuoteItem,
  QuoteTotalsRow,
  SiteDiaryEntry,
  Variation,
} from '../types'

type Result<T> = { data: T | null; error: { message: string } | null }

function unwrap<T>(res: Result<T>): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

/** Postgres numeric comes back as a string; turn the numeric columns of a row into numbers. */
function nums<T>(row: T, keys: (keyof T)[]): T {
  if (!row) return row
  const out = { ...row }
  for (const k of keys) if (out[k] !== null && out[k] !== undefined) (out[k] as unknown) = Number(out[k])
  return out
}

type Patch<T> = Partial<Omit<T, 'id' | 'created_at'>>

/** Minimal CRUD for a table whose rows need numeric coercion on a known set of columns. */
function crud<T extends { id: ID }>(tableName: string, numeric: (keyof T)[] = [], defaultOrder = 'created_at', ascending = false) {
  const fix = (r: T) => nums(r, numeric)
  return {
    async list(filter?: Partial<Record<keyof T, string | number | boolean | null>>): Promise<T[]> {
      let q = supabase.from(tableName).select('*')
      for (const [k, v] of Object.entries(filter ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v as string)
      const rows = unwrap<T[]>(await q.order(defaultOrder, { ascending }))
      return rows.map(fix)
    },
    async get(id: ID): Promise<T | null> {
      const row = unwrap<T | null>(await supabase.from(tableName).select('*').eq('id', id).maybeSingle())
      return row ? fix(row) : null
    },
    async create(values: Patch<T>): Promise<T> {
      return fix(unwrap<T>(await supabase.from(tableName).insert(values as Record<string, unknown>).select('*').single()))
    },
    async update(id: ID, values: Patch<T>): Promise<T> {
      return fix(unwrap<T>(await supabase.from(tableName).update(values as Record<string, unknown>).eq('id', id).select('*').single()))
    },
    async remove(id: ID): Promise<void> {
      unwrap(await supabase.from(tableName).delete().eq('id', id))
    },
  }
}

// ---------- Settings & team ----------

export async function getSettings(): Promise<CompanySettings> {
  const row = unwrap<CompanySettings | null>(await supabase.from('company_settings').select('*').eq('id', true).maybeSingle())
  const fallback: CompanySettings = {
    id: true,
    name: 'My Construction Co',
    reg_no: null,
    vat_no: null,
    address: null,
    phone: null,
    email: null,
    logo_url: null,
    vat_rate: 15,
    quote_terms: null,
    bank_details: null,
    quote_prefix: 'Q',
    next_quote_number: 1,
    invoice_prefix: 'INV',
    next_invoice_number: 1,
  }
  return row ? nums(row, ['vat_rate', 'next_quote_number', 'next_invoice_number']) : fallback
}

export async function updateSettings(values: Partial<Omit<CompanySettings, 'id'>>): Promise<CompanySettings> {
  const row = unwrap<CompanySettings>(
    await supabase
      .from('company_settings')
      .upsert({ id: true, ...values, updated_at: new Date().toISOString() })
      .select('*')
      .single(),
  )
  return nums(row, ['vat_rate', 'next_quote_number', 'next_invoice_number'])
}

export async function listProfiles(): Promise<Profile[]> {
  return unwrap<Profile[]>(await supabase.from('profiles').select('*').order('name'))
}

export async function updateOwnProfile(id: ID, values: Pick<Partial<Profile>, 'name' | 'phone' | 'email_signature'>): Promise<void> {
  unwrap(await supabase.from('profiles').update(values).eq('id', id))
}

// ---------- Clients (Raptor companies + contacts) ----------

export const companies = crud<Company>('companies', [], 'name', true)
export const contacts = crud<Contact>('contacts', [], 'first_name', true)

export function contactName(c: Pick<Contact, 'first_name' | 'last_name'> | null | undefined): string {
  if (!c) return ''
  return `${c.first_name} ${c.last_name}`.trim()
}

export interface ClientDirectory {
  companies: Company[]
  contacts: Contact[]
  companyById: Map<ID, Company>
  contactById: Map<ID, Contact>
}

export async function loadClientDirectory(): Promise<ClientDirectory> {
  const [co, ct] = await Promise.all([companies.list(), contacts.list()])
  return {
    companies: co,
    contacts: ct,
    companyById: new Map(co.map((c) => [c.id, c])),
    contactById: new Map(ct.map((c) => [c.id, c])),
  }
}

/** Display name for a record's client: the company, else the private individual. */
export function clientLabel(dir: ClientDirectory | null, ref: { company_id: ID | null; contact_id: ID | null }): string {
  if (!dir) return ''
  if (ref.company_id) return dir.companyById.get(ref.company_id)?.name ?? 'Unknown company'
  if (ref.contact_id) return contactName(dir.contactById.get(ref.contact_id)) || 'Unknown contact'
  return 'No client'
}

// ---------- Quotes ----------

const QUOTE_NUM: (keyof Quote)[] = ['discount', 'vat_rate']
const ITEM_NUM: (keyof QuoteItem)[] = ['quantity', 'unit_cost', 'markup_pct', 'unit_price', 'sort_order']
export const quotes = crud<Quote>('quotes', QUOTE_NUM)

export async function listQuoteTotals(): Promise<Map<ID, QuoteTotalsRow>> {
  const rows = unwrap<QuoteTotalsRow[]>(await supabase.from('quote_totals').select('*'))
  return new Map(
    rows.map((r) => [r.quote_id, nums(r, ['subtotal', 'estimated_cost', 'discount', 'total_excl', 'vat', 'total_incl'])]),
  )
}

export async function listQuoteItems(quoteId: ID): Promise<QuoteItem[]> {
  const rows = unwrap<QuoteItem[]>(await supabase.from('quote_items').select('*').eq('quote_id', quoteId).order('sort_order'))
  return rows.map((r) => nums(r, ITEM_NUM))
}

export type QuoteItemDraft = Omit<QuoteItem, 'id' | 'quote_id'> & { id?: ID }

/** Replaces a quote's lines with the given list (simplest correct approach for an editor). */
export async function saveQuoteItems(quoteId: ID, items: QuoteItemDraft[]): Promise<QuoteItem[]> {
  unwrap(await supabase.from('quote_items').delete().eq('quote_id', quoteId))
  if (items.length === 0) return []
  const rows = items.map((it, i) => ({
    quote_id: quoteId,
    sort_order: i,
    section: it.section || null,
    description: it.description,
    unit: it.unit,
    quantity: it.quantity,
    unit_cost: it.unit_cost,
    markup_pct: it.markup_pct,
    unit_price: it.unit_price,
  }))
  const saved = unwrap<QuoteItem[]>(await supabase.from('quote_items').insert(rows).select('*'))
  return saved.map((r) => nums(r, ITEM_NUM)).sort((a, b) => a.sort_order - b.sort_order)
}

export async function duplicateQuote(id: ID): Promise<Quote> {
  const q = await quotes.get(id)
  if (!q) throw new Error('Quote not found')
  const items = await listQuoteItems(id)
  const copy = await quotes.create({
    company_id: q.company_id,
    contact_id: q.contact_id,
    title: `${q.title} (copy)`,
    site_address: q.site_address,
    status: 'draft',
    notes: q.notes,
    terms: q.terms,
    discount: q.discount,
    vat_rate: q.vat_rate,
  })
  await saveQuoteItems(copy.id, items)
  return copy
}

/** Accepted quote -> project. Contract value = total excl VAT; budget = estimated cost. */
export async function convertQuoteToProject(id: ID): Promise<Project> {
  const q = await quotes.get(id)
  if (!q) throw new Error('Quote not found')
  const items = await listQuoteItems(id)
  const t = quoteTotals(items, q.discount, q.vat_rate)
  const project = await projects.create({
    name: q.title || `Project from ${q.number ?? 'quote'}`,
    code: q.number ? q.number.replace(/^[A-Z]+-?/i, 'P-') : null,
    company_id: q.company_id,
    contact_id: q.contact_id,
    quote_id: q.id,
    site_address: q.site_address,
    status: 'planned',
    contract_value: t.totalExcl,
    budget: t.estimatedCost,
  })
  await quotes.update(q.id, { project_id: project.id, status: q.status === 'draft' || q.status === 'sent' ? 'accepted' : q.status })
  return project
}

// ---------- Quote attachments ----------

export const quoteAttachments = crud<QuoteAttachment>('quote_attachments', ['sort_order'], 'sort_order', true)

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
}

export async function uploadQuoteAttachment(quoteId: ID, file: File, sortOrder: number): Promise<QuoteAttachment> {
  const path = `${quoteId}/${crypto.randomUUID()}-${safeName(file.name)}`
  const up = await supabase.storage.from(QUOTE_FILES_BUCKET).upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw new Error(up.error.message)
  const isImage = file.type.startsWith('image/')
  return quoteAttachments.create({
    quote_id: quoteId,
    file_path: path,
    file_name: file.name,
    mime_type: file.type || null,
    kind: isImage ? 'render' : 'document',
    sort_order: sortOrder,
    show_on_quote: isImage,
  })
}

export async function deleteQuoteAttachment(a: QuoteAttachment): Promise<void> {
  await supabase.storage.from(QUOTE_FILES_BUCKET).remove([a.file_path])
  await quoteAttachments.remove(a.id)
}

export async function signedUrl(bucket: string, path: string, expiresIn = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  return data?.signedUrl ?? null
}

export async function signedUrls(bucket: string, paths: string[], expiresIn = 3600): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()
  const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, expiresIn)
  return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]))
}

// ---------- Projects ----------

export const projects = crud<Project>('projects', ['contract_value', 'budget'])

const FIN_NUM: (keyof ProjectFinancials)[] = [
  'contract_value', 'approved_variations', 'revised_contract', 'budget', 'expenses_total', 'expenses_materials',
  'expenses_labour', 'expenses_subcontractor', 'expenses_plant_hire', 'expenses_transport', 'expenses_permits',
  'expenses_overheads', 'expenses_other', 'invoiced', 'invoiced_incl', 'received', 'gross_profit', 'margin_pct',
  'budget_remaining',
]

export async function listProjectFinancials(): Promise<Map<ID, ProjectFinancials>> {
  const rows = unwrap<ProjectFinancials[]>(await supabase.from('project_financials').select('*'))
  return new Map(rows.map((r) => [r.project_id, nums(r, FIN_NUM)]))
}

export async function getProjectFinancials(projectId: ID): Promise<ProjectFinancials | null> {
  const row = unwrap<ProjectFinancials | null>(
    await supabase.from('project_financials').select('*').eq('project_id', projectId).maybeSingle(),
  )
  return row ? nums(row, FIN_NUM) : null
}

// ---------- Money ----------

export const expenses = crud<Expense>('expenses', ['amount_excl', 'vat'], 'date')
export const invoices = crud<Invoice>('invoices', ['amount_excl', 'vat'], 'issue_date')
export const payments = crud<Payment>('payments', ['amount'], 'date')
export const variations = crud<Variation>('variations', ['amount_excl'], 'date')

export async function listExpensesBetween(from: string, to: string): Promise<Expense[]> {
  const rows = unwrap<Expense[]>(
    await supabase.from('expenses').select('*').gte('date', from).lte('date', to).order('date', { ascending: false }),
  )
  return rows.map((r) => nums(r, ['amount_excl', 'vat']))
}

export async function listPaymentsBetween(from: string, to: string): Promise<Payment[]> {
  const rows = unwrap<Payment[]>(
    await supabase.from('payments').select('*').gte('date', from).lte('date', to).order('date', { ascending: false }),
  )
  return rows.map((r) => nums(r, ['amount']))
}

export async function listRecentExpenses(limit = 8): Promise<Expense[]> {
  const rows = unwrap<Expense[]>(
    await supabase.from('expenses').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(limit),
  )
  return rows.map((r) => nums(r, ['amount_excl', 'vat']))
}

// ---------- Receipts (slip capture) ----------

export async function uploadReceipt(file: File): Promise<string> {
  const d = new Date()
  const path = `receipts/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}-${safeName(file.name || 'slip.jpg')}`
  const up = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw new Error(up.error.message)
  return path
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Asks the server to read a slip. Never throws for "AI not configured" or a failed read: the
 * capture flow must still work by hand, so both come back as `configured: false` with a message.
 */
export async function extractReceipt(path: string): Promise<ExtractResponse> {
  try {
    const res = await fetch('/api/receipts/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ path }),
    })
    const body = (await res.json().catch(() => null)) as (ExtractResponse & { error?: string }) | null
    if (res.ok && body && 'configured' in body) return body
    return { configured: false, message: body?.error ?? `Slip reading is unavailable (HTTP ${res.status}).` }
  } catch {
    return { configured: false, message: 'Slip reading is unavailable right now. Fill in the details by hand.' }
  }
}

// ---------- Quote sending ----------

export async function sendQuote(quoteId: ID, payload: { to: string[]; cc?: string[]; subject: string; message: string; quoteUrl?: string }) {
  const res = await fetch('/api/quotes/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ quoteId, ...payload }),
  })
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; configured?: boolean } | null
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Sending failed (HTTP ${res.status}).`)
  return body
}

// ---------- Diary ----------

export const diaryEvents = crud<DiaryEvent>('diary_events', [], 'start_at', true)
export const siteDiary = crud<SiteDiaryEntry>('site_diary_entries', ['workers_on_site'], 'date')

export async function listEventsBetween(fromIso: string, toIso: string): Promise<DiaryEvent[]> {
  return unwrap<DiaryEvent[]>(
    await supabase.from('diary_events').select('*').gte('start_at', fromIso).lt('start_at', toIso).order('start_at'),
  )
}

// ---------- Bank ----------

export const bankAccounts = crud<BankAccount>('bank_accounts', [], 'name', true)
export const bankStatements = crud<BankStatement>('bank_statements', [], 'imported_at')
const TX_NUM: (keyof BankTransaction)[] = ['amount', 'balance', 'match_score']
export const bankTransactions = crud<BankTransaction>('bank_transactions', TX_NUM, 'date')

export async function listBankTransactions(statuses?: BankTransaction['status'][]): Promise<BankTransaction[]> {
  let q = supabase.from('bank_transactions').select('*')
  if (statuses?.length) q = q.in('status', statuses)
  const rows = unwrap<BankTransaction[]>(await q.order('date', { ascending: false }).limit(2000))
  return rows.map((r) => nums(r, TX_NUM))
}

export async function countNeedsLinking(): Promise<number> {
  const { count, error } = await supabase
    .from('bank_transactions')
    .select('id', { count: 'exact', head: true })
    .in('status', ['unmatched', 'suggested'])
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Inserts new transactions, silently skipping ones already imported (same account + key). */
export async function insertBankTransactions(rows: Omit<BankTransaction, 'id' | 'created_at'>[]): Promise<BankTransaction[]> {
  if (rows.length === 0) return []
  const inserted = unwrap<BankTransaction[]>(
    await supabase
      .from('bank_transactions')
      .upsert(rows, { onConflict: 'bank_account_id,external_id', ignoreDuplicates: true })
      .select('*'),
  )
  return inserted.map((r) => nums(r, TX_NUM))
}

export async function existingTransactionKeys(bankAccountId: ID, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200)
    const rows = unwrap<{ external_id: string }[]>(
      await supabase.from('bank_transactions').select('external_id').eq('bank_account_id', bankAccountId).in('external_id', chunk),
    )
    rows.forEach((r) => found.add(r.external_id))
  }
  return found
}

export async function uploadStatementFile(file: File): Promise<string> {
  const path = `statements/${crypto.randomUUID()}-${safeName(file.name)}`
  const up = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, { contentType: file.type || 'text/plain' })
  if (up.error) throw new Error(up.error.message)
  return path
}

/** Expense ids a bank transaction has been matched to (for the linked/unlinked indicator). */
export async function listLinkedExpenseIds(): Promise<Set<ID>> {
  const rows = unwrap<{ matched_expense_id: ID | null }[]>(
    await supabase.from('bank_transactions').select('matched_expense_id').eq('status', 'matched').not('matched_expense_id', 'is', null),
  )
  return new Set(rows.map((r) => r.matched_expense_id!).filter(Boolean))
}

export async function listLinkedPaymentIds(): Promise<Set<ID>> {
  const rows = unwrap<{ matched_payment_id: ID | null }[]>(
    await supabase.from('bank_transactions').select('matched_payment_id').eq('status', 'matched').not('matched_payment_id', 'is', null),
  )
  return new Set(rows.map((r) => r.matched_payment_id!).filter(Boolean))
}

// ---------- Email (ported from Raptor: per-person mailbox, synced into activities) ----------

/** Emails logged against a client: a company's own and its people's, or one private contact's. */
export async function listClientEmails(ref: { companyId?: ID; contactIds: ID[] }): Promise<Activity[]> {
  const ors: string[] = []
  if (ref.companyId) ors.push(`company_id.eq.${ref.companyId}`)
  if (ref.contactIds.length) ors.push(`contact_id.in.(${ref.contactIds.join(',')})`)
  if (ors.length === 0) return []
  return unwrap<Activity[]>(
    await supabase
      .from('activities')
      .select('id, type, user_id, company_id, contact_id, subject, notes, activity_date, created_at, email_message_id, is_read, attachment_names')
      .eq('type', 'Email')
      .or(ors.join(','))
      .order('activity_date', { ascending: false })
      .limit(500),
  )
}

export async function setEmailRead(id: ID, isRead: boolean): Promise<void> {
  unwrap(await supabase.from('activities').update({ is_read: isRead }).eq('id', id))
}

/** POSTs (or GETs) one of the api/email/* routes and throws the server's own message on failure. */
async function emailApi<T>(route: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/email/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(await authHeader()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !json) throw new Error(json?.error ?? `Email request failed (HTTP ${res.status}).`)
  return json
}

export const emailStatus = () => emailApi<EmailStatus>('status')

export const connectEmail = (values: { email: string; password: string; smtpHost: string; smtpPort: number; imapHost: string; imapPort: number }) =>
  emailApi<{ ok: true }>('connect', values)

export const disconnectEmail = () => emailApi<{ ok: true }>('disconnect', {})

export const syncEmail = () => emailApi<{ ok: true; logged: number }>('sync', {})

export const sendEmail = (values: { to: string; subject: string; body: string; companyId?: ID | null; contactId?: ID | null; inReplyTo?: string | null }) =>
  emailApi<{ ok: true; messageId: string | null; activityId: ID | null; logError: string | null }>('send', values)

/** Pulls an attachment out of the mailbox through the server and hands it to the browser to save. */
export async function downloadEmailAttachment(activityId: ID, filename: string): Promise<void> {
  const res = await fetch('/api/email/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ activityId, filename }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? 'Could not download that attachment.')
  }
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
