/**
 * Row types for Remus. Field names are the database column names (snake_case), so the data
 * layer in lib/api.ts needs no mapping. Shared tables (profiles, companies, contacts) use the
 * same column names as Raptor's schema.
 */

export type ID = string

// ---------- Shared with Raptor ----------

export type UserRole =
  | 'Administrator'
  | 'Sales Manager'
  | 'Sales Representative'
  | 'Liaison Manager'
  | 'Liaison'
  | 'Pre-legal Team Leader'
  | 'Pre-legal Agent'
  | 'Read Only'

export interface Profile {
  id: ID
  name: string
  email: string
  role: UserRole
  team_id: ID | null
  status: 'Active' | 'Inactive'
  phone: string | null
  avatar_color: string
  created_at: string
  email_signature?: string | null
}

export interface Company {
  id: ID
  name: string
  industry: string | null
  phone: string | null
  email: string | null
  website: string | null
  province: string | null
  city: string | null
  address: string | null
  account_owner_id: ID
  vat_no: string | null
  reg_no: string | null
  notes: string | null
  created_at: string
}

export interface Contact {
  id: ID
  first_name: string
  last_name: string
  job_title: string | null
  company_id: ID | null
  email: string | null
  phone: string | null
  mobile: string | null
  owner_id: ID
  notes: string | null
  address: string | null
  id_number: string | null
  created_at: string
}

/**
 * Raptor's activity row. Remus only logs emails in it (type 'Email'); the subject carries an
 * "Email sent: " / "Email received: " prefix, parsed by lib/emailActivity.ts.
 */
export interface Activity {
  id: ID
  type: string
  user_id: ID
  company_id: ID | null
  contact_id: ID | null
  subject: string
  notes: string | null
  activity_date: string
  created_at: string
  email_message_id: string | null
  is_read: boolean
  attachment_names: string[] | null
}

/** A client is a company (business) or a contact with no company (private individual). */
export interface ClientRef {
  company_id: ID | null
  contact_id: ID | null
}

// ---------- Remus ----------

export interface CompanySettings {
  id: true
  name: string
  reg_no: string | null
  vat_no: string | null
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  vat_rate: number
  /** Off: no VAT on quotes and invoices, and slips are costed at the full amount (migration 0012). */
  vat_registered: boolean
  quote_terms: string | null
  bank_details: string | null
  quote_prefix: string
  next_quote_number: number
  invoice_prefix: string
  next_invoice_number: number
  /** Cost of one worker for one day, by grade. Labour lines on quotes start from these. */
  labour_day_rate_senior: number
  labour_day_rate_junior: number
  /** Default markup % for a new line of each kind. */
  markup_material: number
  markup_labour: number
  markup_subcontractor: number
  /** Default management fee % for a new quote. */
  management_fee_pct: number
  /** Printed under the estimated timeline on every quote that shows one (migration 0015). */
  plan_disclaimer: string
  /** Claude credit bought, in US dollars, all purchases together (migration 0019). Left = this - ai_usage. */
  ai_credit_usd: number
}

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export const UNITS = ['m²', 'm³', 'm', 'each', 'hours', 'day', 'sum'] as const

export const LINE_KINDS = ['material', 'labour', 'subcontractor'] as const
export type LineKind = (typeof LINE_KINDS)[number]
export const LABOUR_GRADES = ['senior', 'junior'] as const
export type LabourGrade = (typeof LABOUR_GRADES)[number]
export type Unit = (typeof UNITS)[number]

export interface Quote extends ClientRef {
  id: ID
  number: string | null
  project_id: ID | null
  title: string
  site_address: string | null
  status: QuoteStatus
  issue_date: string
  valid_until: string | null
  /** A short summary of the job, shown on the quote above the lines. */
  scope: string | null
  notes: string | null
  terms: string | null
  discount: number
  vat_rate: number
  /** Shown to the client as its own line: a % of the lines' total. */
  management_fee_pct: number
  /** Deposit asked for on acceptance, % of the total (migration 0014). */
  deposit_pct: number
  /** Print the estimated timeline (and its clause) on the quote (migration 0015). */
  show_plan: boolean
  /** Where this quote shops (0022): the site and any other areas, each with a radius. Internal. */
  shop_areas: ShopArea[]
  /** Stores outside the areas may still be searched, because they deliver (0022). */
  shop_online: boolean
  /** Internal sign-off before sending; void once the total excl. VAT differs from approved_total. */
  approved_at: string | null
  approved_by: ID | null
  approved_total: number | null
  sent_at: string | null
  sent_to: string | null
  created_at: string
  updated_at: string
}

export const SUB_RATE_UNITS = ['day', 'job', 'hour', 'm²', 'each'] as const
export type SubRateUnit = (typeof SUB_RATE_UNITS)[number]

/** Someone Urban Haus hires in (migration 0014). Internal: never shown to clients. */
export interface Subcontractor {
  id: ID
  name: string
  trade: string | null
  contact_person: string | null
  phone: string | null
  email: string | null
  rate_amount: number | null
  rate_unit: SubRateUnit
  vat_no: string | null
  bank_details: string | null
  notes: string | null
  rating: number | null
  active: boolean
  created_at: string
}

/** A section of a quote seen as a stage of the work (migration 0011). `name` '' = the unnamed group. */
export interface QuoteStage {
  id: ID
  quote_id: ID
  name: string
  sort_order: number
  duration_days: number
  start_mode: 'start' | 'with' | 'after'
  start_ref: string | null
  lag_days: number
}

/** One place a quote looks for stores: an address (or the site's) and how far from it (0022). */
export interface ShopArea {
  label: string
  /** Empty on the "Site" area: it follows the quote's site address. */
  address: string
  radiusKm: number
}

/** One of the branches Urban Haus shops at, entered once in Settings → My stores (0023). */
export interface MyStore {
  id: ID
  /** The chain, as Find prices names it (builders, cashbuild, ...), or 'other'. */
  store: string
  name: string
  address: string | null
  lat: number | null
  lon: number | null
  favourite: boolean
  notes: string | null
  created_at: string
}

export interface QuoteItem {
  id: ID
  quote_id: ID
  sort_order: number
  section: string | null
  description: string
  /** Longer write-up under the description: what the line includes. Optional. */
  details: string | null
  kind: LineKind
  /** Labour lines only: priced from the senior or junior day rate. */
  labour_grade: LabourGrade | null
  /** Subcontractor lines: who does it. Internal, never printed on the quote. */
  subcontractor_id: ID | null
  unit: Unit
  quantity: number
  unit_cost: number
  markup_pct: number
  unit_price: number
  /*
   * WHERE TO BUY IT (migration 0020): the store, its own product code, the product as the store names
   * it, its page, the price there and the day it was seen. From Find prices' "Use", or typed. Internal,
   * never on the client's quote; read by the shopping list.
   */
  buy_store: string | null
  buy_code: string | null
  buy_product: string | null
  buy_url: string | null
  buy_price: number | null
  buy_checked_on: string | null
}

export interface QuoteTotalsRow {
  quote_id: ID
  subtotal: number
  estimated_cost: number
  discount: number
  total_excl: number
  vat: number
  total_incl: number
  management_fee: number
}

export const ATTACHMENT_KINDS = ['render', 'photo', 'document', 'client_pdf'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export interface QuoteAttachment {
  id: ID
  quote_id: ID
  file_path: string
  file_name: string
  mime_type: string | null
  kind: AttachmentKind
  caption: string | null
  sort_order: number
  show_on_quote: boolean
  created_at: string
}

export const PROJECT_STATUSES = ['lead', 'planned', 'active', 'on_hold', 'completed', 'cancelled'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export interface Project extends ClientRef {
  id: ID
  name: string
  code: string | null
  quote_id: ID | null
  site_address: string | null
  status: ProjectStatus
  start_date: string | null
  end_date: string | null
  contract_value: number
  budget: number
  notes: string | null
  created_at: string
}

export const EXPENSE_CATEGORIES = [
  'materials',
  'labour',
  'subcontractor',
  'plant_hire',
  'transport',
  'permits',
  'overheads',
  'other',
] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export type ExpenseSource = 'manual' | 'receipt' | 'bank'

export interface Expense {
  id: ID
  project_id: ID | null
  date: string
  category: ExpenseCategory
  supplier: string | null
  description: string | null
  amount_excl: number
  vat: number
  receipt_url: string | null
  receipt_path: string | null
  receipt_number: string | null
  ai_extracted: ReceiptExtraction | null
  ai_suggestion: ReceiptSuggestion | null
  source: ExpenseSource
  paid: boolean
  /** The project stage it was spent on (migration 0016), for quoted vs actual per stage. */
  stage_id: ID | null
  created_at: string
}

/** Someone on site (migration 0016). Not a login: most workers never sign in. */
export interface Worker {
  id: ID
  name: string
  trade: string | null
  grade: LabourGrade
  /** What a day of this person costs Urban Haus. */
  day_cost: number
  phone: string | null
  notes: string | null
  active: boolean
  created_at: string
}

/** A stage of a project with real dates, and what the quote priced it at (excl. VAT). */
export interface ProjectStage {
  id: ID
  project_id: ID
  name: string
  sort_order: number
  start_date: string | null
  /** Last working day, inclusive. */
  end_date: string | null
  quoted_sell: number
  quoted_material: number
  quoted_labour: number
  quoted_subcontractor: number
  created_at: string
}

/** A worker on a stage, for a run of days. */
export interface StageBooking {
  id: ID
  stage_id: ID
  worker_id: ID
  start_date: string
  end_date: string
  created_at: string
}

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export interface Invoice extends ClientRef {
  id: ID
  project_id: ID | null
  number: string | null
  issue_date: string
  due_date: string | null
  description: string | null
  amount_excl: number
  vat: number
  status: InvoiceStatus
  created_at: string
}

export const PAYMENT_METHODS = ['eft', 'cash', 'card', 'cheque', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export interface Payment {
  id: ID
  invoice_id: ID | null
  project_id: ID | null
  date: string
  amount: number
  method: PaymentMethod | null
  reference: string | null
  created_at: string
}

export interface Variation {
  id: ID
  project_id: ID
  description: string
  amount_excl: number
  approved: boolean
  date: string
  created_at: string
}

export const EVENT_TYPES = ['site_visit', 'meeting', 'inspection', 'delivery', 'quote_appointment', 'other'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface DiaryEvent extends ClientRef {
  id: ID
  title: string
  start_at: string
  end_at: string | null
  all_day: boolean
  project_id: ID | null
  location: string | null
  type: EventType
  notes: string | null
  owner_id: ID | null
  created_at: string
}

export interface SiteDiaryEntry {
  id: ID
  project_id: ID
  date: string
  weather: string | null
  workers_on_site: number | null
  work_done: string | null
  materials_delivered: string | null
  delays: string | null
  safety_notes: string | null
  created_at: string
}

export interface ProjectFinancials {
  project_id: ID
  contract_value: number
  approved_variations: number
  revised_contract: number
  budget: number
  expenses_total: number
  expenses_materials: number
  expenses_labour: number
  expenses_subcontractor: number
  expenses_plant_hire: number
  expenses_transport: number
  expenses_permits: number
  expenses_overheads: number
  expenses_other: number
  invoiced: number
  invoiced_incl: number
  received: number
  gross_profit: number
  margin_pct: number | null
  budget_remaining: number
}

// ---------- Bank reconciliation ----------

export const BANKS = ['fnb', 'absa', 'standard_bank', 'nedbank', 'capitec', 'investec', 'other'] as const
export type Bank = (typeof BANKS)[number]

/** How columns of a bank CSV map onto a transaction. Saved per bank account. */
export interface CsvMapping {
  date: string
  description: string
  /** Either one signed amount column... */
  amount?: string
  /** ...or separate debit/credit columns. */
  debit?: string
  credit?: string
  balance?: string
  reference?: string
  /** Day-first (dd/mm/yyyy) is the SA default. */
  dateFormat: 'auto' | 'dmy' | 'mdy' | 'ymd'
  /** Some banks export debits as positive numbers in a single column. */
  invertSign?: boolean
}

export interface BankAccount {
  id: ID
  name: string
  bank: Bank | null
  account_number_last4: string | null
  csv_mapping: CsvMapping | null
  feed_provider: string
  created_at: string
}

export interface BankStatement {
  id: ID
  bank_account_id: ID
  period_start: string | null
  period_end: string | null
  file_path: string | null
  file_name: string | null
  imported_count: number
  duplicate_count: number
  imported_at: string
}

export type BankTxStatus = 'unmatched' | 'suggested' | 'matched' | 'ignored'

export interface BankTransaction {
  id: ID
  bank_account_id: ID
  statement_id: ID | null
  date: string
  description: string
  amount: number
  balance: number | null
  reference: string | null
  external_id: string
  status: BankTxStatus
  matched_expense_id: ID | null
  matched_payment_id: ID | null
  match_score: number | null
  ignore_reason: string | null
  created_at: string
}

// ---------- AI slip reading (api/receipts/extract.ts) ----------

export interface ReceiptLineItem {
  description: string
  quantity: number | null
  amount: number | null
}

export interface ReceiptExtraction {
  supplier: string | null
  date: string | null
  slip_number: string | null
  total_incl: number | null
  vat: number | null
  amount_excl: number | null
  payment_method: string | null
  card_last4: string | null
  line_items: ReceiptLineItem[]
}

export interface ReceiptSuggestion {
  project_id: string | null
  category: ExpenseCategory
  confidence: 'low' | 'medium' | 'high'
  reason: string
}

export type ExtractResponse =
  | { configured: true; extraction: ReceiptExtraction; suggestion: ReceiptSuggestion | null }
  | { configured: false; message: string }
