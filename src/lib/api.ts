/**
 * Typed data access for Remus. Every page goes through here, never `supabase.from` directly, so
 * the queries are in one place when this is lifted into Raptor.
 *
 * Functions throw on error (with the PostgREST message); pages catch and show it.
 */
import { supabase, BRANDING_BUCKET, QUOTE_FILES_BUCKET, RECEIPTS_BUCKET } from './supabase'
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
  QuoteStage,
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
    labour_day_rate_senior: 0,
    labour_day_rate_junior: 0,
    markup_material: 20,
    markup_labour: 20,
    markup_subcontractor: 10,
    management_fee_pct: 0,
  }
  return row
    ? nums({ ...fallback, ...row }, [
        'vat_rate', 'next_quote_number', 'next_invoice_number', 'labour_day_rate_senior', 'labour_day_rate_junior',
        'markup_material', 'markup_labour', 'markup_subcontractor', 'management_fee_pct',
      ])
    : fallback
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

/** Administrators only (enforced by RLS and the protect_profile_privileged_fields trigger). */
export async function updateProfileAccess(id: ID, values: Pick<Partial<Profile>, 'role' | 'status'>): Promise<void> {
  const rows = unwrap<Profile[]>(await supabase.from('profiles').update(values).eq('id', id).select('*'))
  if (rows.length === 0) throw new Error('Only administrators can change access.')
}

export async function inviteUser(payload: { email: string; name?: string; role: Profile['role'] }): Promise<void> {
  const res = await fetch('/api/team/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Invite failed (HTTP ${res.status}).`)
}

// ---------- Claude connector tokens ----------

export interface ApiToken {
  id: ID
  name: string
  token_hint: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export async function listApiTokens(): Promise<ApiToken[]> {
  return unwrap<ApiToken[]>(
    await supabase.from('api_tokens').select('id, name, token_hint, created_at, last_used_at, revoked_at').is('revoked_at', null).order('created_at', { ascending: false }),
  )
}

/** Creates a personal access token for the connector. The token is returned once; only its hash is stored. */
export async function createApiToken(name: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = `remus_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  unwrap(await supabase.from('api_tokens').insert({ name: name.trim() || 'Claude', token_hash: hash, token_hint: token.slice(-4) }))
  return token
}

export async function revokeApiToken(id: ID): Promise<void> {
  unwrap(await supabase.from('api_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id))
}

/** Uploads the letterhead logo to the public 'branding' bucket and returns its public URL. */
export async function uploadLogo(file: File): Promise<string> {
  const path = `logo/${crypto.randomUUID()}-${safeName(file.name || 'logo.png')}`
  const up = await supabase.storage.from(BRANDING_BUCKET).upload(path, file, { contentType: file.type || undefined })
  if (up.error) throw new Error(up.error.message)
  return supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl
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

/** The client's own address (the company's, else the contact person's), used to prefill a site address. */
export function clientAddress(dir: ClientDirectory | null, ref: { company_id: ID | null; contact_id: ID | null }): string | null {
  if (!dir) return null
  const company = ref.company_id ? dir.companyById.get(ref.company_id) : null
  const contact = ref.contact_id ? dir.contactById.get(ref.contact_id) : null
  return company?.address?.trim() || contact?.address?.trim() || null
}

/** Display name for a record's client: the company, else the private individual. */
export function clientLabel(dir: ClientDirectory | null, ref: { company_id: ID | null; contact_id: ID | null }): string {
  if (!dir) return ''
  if (ref.company_id) return dir.companyById.get(ref.company_id)?.name ?? 'Unknown company'
  if (ref.contact_id) return contactName(dir.contactById.get(ref.contact_id)) || 'Unknown contact'
  return 'No client'
}

// ---------- Quotes ----------

const QUOTE_NUM: (keyof Quote)[] = ['discount', 'vat_rate', 'management_fee_pct', 'approved_total']
const ITEM_NUM: (keyof QuoteItem)[] = ['quantity', 'unit_cost', 'markup_pct', 'unit_price', 'sort_order']
export const quotes = crud<Quote>('quotes', QUOTE_NUM)

export async function listQuoteTotals(): Promise<Map<ID, QuoteTotalsRow>> {
  const rows = unwrap<QuoteTotalsRow[]>(await supabase.from('quote_totals').select('*'))
  return new Map(
    rows.map((r) => [r.quote_id, nums(r, ['subtotal', 'estimated_cost', 'discount', 'total_excl', 'vat', 'total_incl', 'management_fee'])]),
  )
}

export async function listQuoteItems(quoteId: ID): Promise<QuoteItem[]> {
  const rows = unwrap<QuoteItem[]>(await supabase.from('quote_items').select('*').eq('quote_id', quoteId).order('sort_order'))
  return rows.map((r) => nums(r, ITEM_NUM))
}

export type QuoteItemDraft = Omit<QuoteItem, 'id' | 'quote_id'> & { id?: ID }

/**
 * Replaces a quote's lines with the given list. The new rows go in first and the old ones are
 * removed after, so a failed insert never leaves the quote empty.
 */
export async function saveQuoteItems(quoteId: ID, items: QuoteItemDraft[]): Promise<QuoteItem[]> {
  const old = unwrap<{ id: ID }[]>(await supabase.from('quote_items').select('id').eq('quote_id', quoteId))
  let saved: QuoteItem[] = []
  if (items.length > 0) {
    const rows = items.map((it, i) => ({
      quote_id: quoteId,
      sort_order: i,
      section: it.section || null,
      description: it.description,
      details: it.details?.trim() || null,
      kind: it.kind ?? 'material',
      labour_grade: it.kind === 'labour' ? it.labour_grade ?? 'senior' : null,
      unit: it.unit,
      quantity: it.quantity,
      unit_cost: it.unit_cost,
      markup_pct: it.markup_pct,
      unit_price: it.unit_price,
    }))
    saved = unwrap<QuoteItem[]>(await supabase.from('quote_items').insert(rows).select('*'))
  }
  if (old.length > 0) unwrap(await supabase.from('quote_items').delete().in('id', old.map((r) => r.id)))
  return saved.map((r) => nums(r, ITEM_NUM)).sort((a, b) => a.sort_order - b.sort_order)
}

// ---------- Quote stages (migration 0011) ----------

const STAGE_NUM: (keyof QuoteStage)[] = ['sort_order', 'duration_days', 'lag_days']
export type QuoteStageDraft = Omit<QuoteStage, 'id' | 'quote_id' | 'sort_order'>

export async function listQuoteStages(quoteId: ID): Promise<QuoteStage[]> {
  const rows = unwrap<QuoteStage[]>(await supabase.from('quote_stages').select('*').eq('quote_id', quoteId).order('sort_order'))
  return rows.map((r) => nums(r, STAGE_NUM))
}

/** Replaces a quote's stages, in order. Upsert by name first, then remove the ones gone. */
export async function saveQuoteStages(quoteId: ID, stages: QuoteStageDraft[]): Promise<void> {
  if (stages.length > 0) {
    const rows = stages.map((s, i) => ({
      quote_id: quoteId,
      name: s.name,
      sort_order: i,
      duration_days: Math.max(0, Math.round(Number(s.duration_days) || 0)),
      start_mode: s.start_mode,
      start_ref: s.start_ref,
      lag_days: Math.round(Number(s.lag_days) || 0),
    }))
    unwrap(await supabase.from('quote_stages').upsert(rows, { onConflict: 'quote_id,name' }))
  }
  const keep = new Set(stages.map((s) => s.name))
  const old = unwrap<{ id: ID; name: string }[]>(await supabase.from('quote_stages').select('id, name').eq('quote_id', quoteId))
  const gone = old.filter((s) => !keep.has(s.name)).map((s) => s.id)
  if (gone.length) unwrap(await supabase.from('quote_stages').delete().in('id', gone))
}

export async function duplicateQuote(id: ID): Promise<Quote> {
  const q = await quotes.get(id)
  if (!q) throw new Error('Quote not found')
  const [items, stages] = await Promise.all([listQuoteItems(id), listQuoteStages(id)])
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
    management_fee_pct: q.management_fee_pct,
  })
  await saveQuoteItems(copy.id, items)
  await saveQuoteStages(copy.id, stages)
  return copy
}

/** Accepted quote -> project. Contract value = total excl VAT; budget = estimated cost. */
export async function convertQuoteToProject(id: ID): Promise<Project> {
  const q = await quotes.get(id)
  if (!q) throw new Error('Quote not found')
  const items = await listQuoteItems(id)
  const t = quoteTotals(items, q.discount, q.vat_rate, q.management_fee_pct)
  const values: Patch<Project> = {
    name: q.title || `Project from ${q.number ?? 'quote'}`,
    code: q.number ? `P-${q.number.replace(/^.*?(\d+)$/, '$1')}` : null,
    company_id: q.company_id,
    contact_id: q.contact_id,
    quote_id: q.id,
    site_address: q.site_address,
    status: 'planned',
    contract_value: t.totalExcl,
    budget: t.estimatedCost,
  }
  let project: Project
  try {
    project = await projects.create(values)
  } catch (e) {
    // The derived code may already be taken by a project made by hand; leave it blank then.
    if (!(e instanceof Error) || !/projects_code_key|duplicate key/i.test(e.message)) throw e
    project = await projects.create({ ...values, code: null })
  }
  try {
    await quotes.update(q.id, { project_id: project.id, status: 'accepted', updated_at: new Date().toISOString() })
  } catch (e) {
    await projects.remove(project.id).catch(() => {})
    throw e
  }
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

/** Turns a fetch that never got an answer ("Load failed", "Failed to fetch") into a plain message. */
async function callApi(input: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new Error(`Couldn't reach the server to ${what}. Check your connection and try again.`)
  }
}

export async function sendQuote(quoteId: ID, payload: { to: string[]; cc?: string[]; subject: string; message: string; quoteUrl?: string }) {
  const res = await callApi('/api/quotes/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ quoteId, ...payload }),
  }, 'send the quote')
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; configured?: boolean; warning?: string } | null
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Sending failed (HTTP ${res.status}). Try again, or download the PDF and email it yourself.`)
  return body
}

export interface EmailSetup {
  configured: boolean
  /** The address quotes will go out from, when known. */
  from: string | null
  /** True when that is the person's own connected mailbox rather than the company sender. */
  own: boolean
}

/**
 * Whether, and from where, the server can send this person's email (so the Send dialog can say so
 * before anyone tries). Null when the check itself failed: let them try, and show the error then.
 */
export async function emailConfigured(): Promise<EmailSetup | null> {
  try {
    const res = await fetch('/api/quotes/send?check=1', { headers: await authHeader() })
    const body = (await res.json().catch(() => null)) as Partial<EmailSetup> | null
    if (typeof body?.configured !== 'boolean') return null
    return { configured: body.configured, from: body.from ?? null, own: !!body.own }
  } catch {
    return null
  }
}

export interface MailboxDetails {
  email: string
  password: string
  smtpHost: string
  smtpPort: number
  imapHost: string
  imapPort: number
}

/** The signed-in person's own mailbox (api/email/mailbox.ts). Never includes the password. */
export async function mailboxStatus(): Promise<{ connected: boolean; email: string | null; lastSyncedAt?: string | null }> {
  const res = await callApi('/api/email/mailbox', { headers: await authHeader() }, 'check your mailbox')
  const body = (await res.json().catch(() => null)) as { connected?: boolean; email?: string | null; error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `Could not check your mailbox (HTTP ${res.status}).`)
  return { connected: !!body?.connected, email: body?.email ?? null }
}

/** Logs in over IMAP and SMTP on the server, and saves the mailbox only when both work. */
export async function connectMailbox(details: MailboxDetails): Promise<void> {
  const res = await callApi('/api/email/mailbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(details),
  }, 'connect your mailbox')
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `Could not connect that mailbox (HTTP ${res.status}).`)
}

export async function disconnectMailbox(): Promise<void> {
  const res = await callApi('/api/email/mailbox', { method: 'DELETE', headers: await authHeader() }, 'disconnect your mailbox')
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `Could not disconnect your mailbox (HTTP ${res.status}).`)
}

/** Opens the server-built PDF of a quote in a new tab (the endpoint needs the session token, so fetch it first). */
/**
 * `beforeBuild` runs after the new tab is opened (iPad Safari only allows a tab opened straight
 * from the tap) and before the PDF is built: the editor saves there, so the PDF never shows an
 * older version than the screen. Returning false stops it.
 */
export async function openQuotePdf(quoteId: ID, beforeBuild?: () => Promise<boolean>): Promise<void> {
  const win = window.open('', '_blank')
  let res: Response
  try {
    if (beforeBuild && !(await beforeBuild())) {
      win?.close()
      return
    }
    res = await callApi(`/api/quotes/pdf?id=${encodeURIComponent(quoteId)}`, { headers: await authHeader() }, 'build the PDF')
  } catch (e) {
    win?.close()
    throw e
  }
  if (!res.ok) {
    win?.close()
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Could not build the PDF (HTTP ${res.status}).`)
  }
  const url = URL.createObjectURL(await res.blob())
  if (win) win.location.href = url
  else window.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
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

/**
 * PostgREST returns at most 1000 rows per request (less if the project lowers max-rows), so the
 * bank screens page through with .range until a page comes back empty. `max` bounds the total.
 */
async function pageAll<T>(query: (from: number, to: number) => PromiseLike<Result<T[]>>, max = 20_000): Promise<T[]> {
  const out: T[] = []
  while (out.length < max) {
    const rows = unwrap<T[]>(await query(out.length, out.length + 999)) ?? []
    if (rows.length === 0) break
    out.push(...rows)
  }
  return out
}

export async function listBankTransactions(statuses?: BankTransaction['status'][]): Promise<BankTransaction[]> {
  const rows = await pageAll<BankTransaction>((from, to) => {
    let q = supabase.from('bank_transactions').select('*')
    if (statuses?.length) q = q.in('status', statuses)
    // id breaks ties so pages never overlap or skip rows on the same date.
    return q.order('date', { ascending: false }).order('id').range(from, to)
  })
  return rows.map((r) => nums(r, TX_NUM))
}

/** Expenses dated in [from, to] (yyyy-mm-dd), every page: the reconciliation window. */
export async function listBankExpenses(from: string, to: string): Promise<Expense[]> {
  const rows = await pageAll<Expense>((a, b) =>
    supabase.from('expenses').select('*').gte('date', from).lte('date', to).order('date', { ascending: false }).order('id').range(a, b),
  )
  return rows.map((r) => nums(r, ['amount_excl', 'vat']))
}

export async function listBankPayments(from: string, to: string): Promise<Payment[]> {
  const rows = await pageAll<Payment>((a, b) =>
    supabase.from('payments').select('*').gte('date', from).lte('date', to).order('date', { ascending: false }).order('id').range(a, b),
  )
  return rows.map((r) => nums(r, ['amount']))
}

export async function listBankInvoices(): Promise<Invoice[]> {
  const rows = await pageAll<Invoice>((a, b) => supabase.from('invoices').select('*').order('issue_date', { ascending: false }).order('id').range(a, b))
  return rows.map((r) => nums(r, ['amount_excl', 'vat']))
}

/** Payments recorded against an invoice (to decide whether it is still fully paid). */
export async function listInvoicePayments(invoiceId: ID): Promise<Payment[]> {
  const rows = unwrap<Payment[]>(await supabase.from('payments').select('*').eq('invoice_id', invoiceId))
  return rows.map((r) => nums(r, ['amount']))
}

/** Same rule as needsLinking() in reconcile.ts: open lines, plus 'matched' lines with nothing linked. */
export async function countNeedsLinking(): Promise<number> {
  const { count, error } = await supabase
    .from('bank_transactions')
    .select('id', { count: 'exact', head: true })
    .or('status.in.(unmatched,suggested),and(status.eq.matched,matched_expense_id.is.null,matched_payment_id.is.null)')
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

/**
 * Creates the statement row and its transactions. If the transaction insert fails the statement
 * is deleted again, so no empty statement with wrong counts is left behind; if some rows were
 * already there (a concurrent import), the counts are corrected to what was really inserted.
 */
export async function importBankStatement(
  statement: Omit<BankStatement, 'id' | 'imported_at'>,
  rows: Omit<BankTransaction, 'id' | 'created_at' | 'statement_id'>[],
): Promise<{ statement: BankStatement; inserted: BankTransaction[] }> {
  let created = await bankStatements.create(statement)
  let inserted: BankTransaction[]
  try {
    inserted = await insertBankTransactions(rows.map((r) => ({ ...r, statement_id: created.id })))
  } catch (e) {
    await bankStatements.remove(created.id).catch(() => {})
    throw e
  }
  if (inserted.length === 0) {
    await bankStatements.remove(created.id)
    return { statement: created, inserted }
  }
  if (inserted.length !== statement.imported_count) {
    created = await bankStatements.update(created.id, {
      imported_count: inserted.length,
      duplicate_count: statement.duplicate_count + statement.imported_count - inserted.length,
    })
  }
  return { statement: created, inserted }
}

/** Deletes a statement; its transactions go with it (statement_id is ON DELETE CASCADE). */
export async function deleteBankStatement(s: BankStatement): Promise<void> {
  // Delete the lines explicitly too, so this works whether or not the FK cascades (migration 0003).
  unwrap(await supabase.from('bank_transactions').delete().eq('statement_id', s.id))
  await bankStatements.remove(s.id)
  // Removing the stored file is tidy-up only; a leftover file harms nothing.
  if (s.file_path) await supabase.storage.from(RECEIPTS_BUCKET).remove([s.file_path])
}

/** Sets the same values on many transactions: one PATCH per 200 ids instead of one per row. */
export async function updateBankTransactions(ids: ID[], values: Partial<Omit<BankTransaction, 'id' | 'created_at'>>): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    unwrap(await supabase.from('bank_transactions').update(values).in('id', ids.slice(i, i + 200)))
  }
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
  // Browsers give .ofx/.qfx no (or an odd) MIME type, which the bucket may reject.
  const contentType = /\.(ofx|qfx)$/i.test(file.name) ? 'application/x-ofx' : file.type || 'text/plain'
  const up = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, { contentType })
  if (up.error) throw new Error(up.error.message)
  return path
}

/** Expense ids a bank transaction has been matched to (for the linked/unlinked indicator). */
export async function listLinkedExpenseIds(): Promise<Set<ID>> {
  const rows = await pageAll<{ matched_expense_id: ID | null }>((from, to) =>
    supabase.from('bank_transactions').select('matched_expense_id').eq('status', 'matched').not('matched_expense_id', 'is', null).order('id').range(from, to),
  )
  return new Set(rows.map((r) => r.matched_expense_id!).filter(Boolean))
}

export async function listLinkedPaymentIds(): Promise<Set<ID>> {
  const rows = await pageAll<{ matched_payment_id: ID | null }>((from, to) =>
    supabase.from('bank_transactions').select('matched_payment_id').eq('status', 'matched').not('matched_payment_id', 'is', null).order('id').range(from, to),
  )
  return new Set(rows.map((r) => r.matched_payment_id!).filter(Boolean))
}

// ---------- Client emails (ported from Raptor: synced into activities, sent from your own mailbox) ----------

const EMAIL_COLUMNS = 'id, type, user_id, company_id, contact_id, subject, notes, activity_date, created_at, email_message_id, is_read, attachment_names'

/** Emails logged against a client: a company's own and its people's, or one private contact's. */
export async function listClientEmails(ref: { companyId?: ID; contactIds: ID[] }): Promise<Activity[]> {
  const ors: string[] = []
  if (ref.companyId) ors.push(`company_id.eq.${ref.companyId}`)
  if (ref.contactIds.length) ors.push(`contact_id.in.(${ref.contactIds.join(',')})`)
  if (ors.length === 0) return []
  return unwrap<Activity[]>(
    await supabase
      .from('activities')
      .select(EMAIL_COLUMNS)
      .eq('type', 'Email')
      .or(ors.join(','))
      .order('activity_date', { ascending: false })
      .limit(500),
  )
}

/** Fired after any email is marked read or unread, so the unread counts recount (lib/unreadMail). */
export const MAIL_CHANGED = 'remus:mail-changed'

export async function setEmailRead(id: ID, isRead: boolean): Promise<void> {
  const row = unwrap<{ user_id: ID; email_message_id: string | null }>(
    await supabase.from('activities').update({ is_read: isRead }).eq('id', id).select('user_id, email_message_id').single(),
  )
  // The same message in the person's own mailbox reads the same way (the Mail page and its badge).
  if (row.email_message_id) {
    await supabase
      .from('user_emails')
      .update({ read_at: isRead ? new Date().toISOString() : null })
      .eq('user_id', row.user_id)
      .eq('message_id', row.email_message_id)
  }
  window.dispatchEvent(new Event(MAIL_CHANGED))
}

/** Every client email in one list, for the Mail page. `mine` limits it to the person's own mailbox. */
export async function listAllEmails(opts: { userId?: ID; limit?: number } = {}): Promise<Activity[]> {
  let q = supabase.from('activities').select(EMAIL_COLUMNS).eq('type', 'Email')
  if (opts.userId) q = q.eq('user_id', opts.userId)
  return unwrap<Activity[]>(await q.order('activity_date', { ascending: false }).limit(opts.limit ?? 500))
}

/** Files new mail from known clients now, instead of waiting for the daily sync. */
export async function syncMailbox(): Promise<{ logged: number }> {
  const res = await callApi('/api/email/sync', { method: 'POST', headers: await authHeader() }, 'check your mailbox')
  const body = (await res.json().catch(() => null)) as { logged?: number; error?: string } | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Could not check your mailbox (HTTP ${res.status}).`)
  return { logged: body.logged ?? 0 }
}

/** Emails a client from your own mailbox and files it on their Emails card. */
export async function sendEmail(values: { to: string; cc?: string[]; subject: string; body: string; companyId?: ID | null; contactId?: ID | null; inReplyTo?: string | null }): Promise<void> {
  const res = await callApi('/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(values),
  }, 'send the email')
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Sending failed (HTTP ${res.status}).`)
}

/** Pulls an attachment out of the mailbox through the server and hands it to the browser to save. */
export async function downloadEmailAttachment(activityId: ID, filename: string): Promise<void> {
  const res = await callApi('/api/email/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ activityId, filename }),
  }, 'download the attachment')
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
