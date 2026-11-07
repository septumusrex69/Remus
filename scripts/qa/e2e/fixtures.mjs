/**
 * A small building firm, invented but shaped like the real one (Remus · Handover 8; Raptor's fixtures.mjs, adapted).
 *
 * NO DATABASE AND NO CREDENTIALS. The browser tests answer every request from here, so they run on any machine,
 * cannot be broken by somebody editing the live data, and the screen's contents are known.
 *
 * The shapes follow the tables (src/types.ts). A fixture that is the wrong shape tests the fixture, so when a page
 * reads a new column, add it here.
 */

export const USER_ID = '11111111-1111-4111-8111-111111111111'
export const BOSS_ID = '11111111-1111-4111-8111-1111111111bb'
export const COMPANY_ID = '22222222-2222-4222-8222-222222222222'
export const CONTACT_ID = '33333333-3333-4333-8333-333333333333'
export const PROJECT_ID = '44444444-4444-4444-8444-444444444444'
export const QUOTE_ID = '55555555-5555-4555-8555-555555555555'
export const EXPENSE_ID = '66666666-6666-4666-8666-666666666666'
export const RETURN_ID = '77777777-7777-4777-8777-777777777777'
export const REQUEST_ID = '88888888-8888-4888-8888-888888888888'

const T0 = '2026-10-01T08:00:00Z'

/** An Administrator who is NOT the Big Boss: may ask and note, may not approve what gets built. */
export const ADMIN = {
  id: USER_ID,
  name: 'Test Admin',
  email: 'admin@urbanhaus.test',
  role: 'Administrator',
  team_id: null,
  status: 'Active',
  phone: null,
  avatar_color: '#454B50',
  created_at: T0,
  email_signature: null,
  job: 'contractor',
  can_snap: true,
  is_boss: false,
}

export const BOSS = { ...ADMIN, id: BOSS_ID, name: 'Test Boss', email: 'boss@urbanhaus.test', is_boss: true }

export const SETTINGS = {
  id: true,
  name: 'Urban Haus Construction',
  reg_no: null, vat_no: null, address: '1 Test Street, Pretoria', phone: null, email: 'info@urbanhaus.test',
  logo_url: null,
  vat_rate: 15, vat_registered: true,
  quote_terms: null, bank_details: null,
  quote_prefix: 'Q', next_quote_number: 2, invoice_prefix: 'INV', next_invoice_number: 1,
  labour_day_rate_senior: 900, labour_day_rate_junior: 450,
  markup_material: 20, markup_labour: 20, markup_subcontractor: 15, management_fee_pct: 10,
  max_jobs: 4,
  brand_photos: {},
  plan_disclaimer: '',
  ai_credit_usd: 0,
}

export const COMPANY = {
  id: COMPANY_ID, name: 'Test Client (Pty) Ltd', industry: null, phone: '012 000 0000', email: 'client@example.test',
  website: null, province: 'Gauteng', city: 'Pretoria', address: '2 Client Road', account_owner_id: USER_ID,
  vat_no: null, reg_no: null, notes: null, created_at: T0,
}

export const CONTACT = {
  id: CONTACT_ID, first_name: 'Thandi', last_name: 'Client', job_title: null, company_id: COMPANY_ID,
  email: 'thandi@example.test', phone: '012 000 0001', mobile: '082 000 0000', owner_id: USER_ID, notes: null,
  address: null, id_number: null, created_at: T0,
}

export const PROJECT = {
  id: PROJECT_ID, name: 'Kitchen at 2 Client Road', code: 'UH-001', quote_id: QUOTE_ID, site_address: '2 Client Road, Pretoria',
  status: 'active', start_date: '2026-10-05', end_date: '2026-12-15', contract_value: 300000, budget: 250000,
  notes: null, created_at: T0, company_id: COMPANY_ID, contact_id: CONTACT_ID,
}

export const QUOTE = {
  id: QUOTE_ID, number: 'Q0001', project_id: PROJECT_ID, title: 'Kitchen renovation', site_address: '2 Client Road, Pretoria',
  status: 'accepted', issue_date: '2026-09-20', valid_until: '2026-10-20', scope: 'A new kitchen.', notes: null, terms: null,
  discount: 0, vat_rate: 15, management_fee_pct: 10, deposit_pct: 50, show_plan: false, shop_areas: [], shop_online: false,
  approved_at: null, approved_by: null, approved_total: null, sent_at: null, sent_to: null,
  created_at: T0, updated_at: T0, company_id: COMPANY_ID, contact_id: CONTACT_ID,
}

export const EXPENSE = {
  id: EXPENSE_ID, project_id: PROJECT_ID, date: '2026-10-20', category: 'materials', supplier: 'Builders Warehouse',
  description: 'Cement', amount_excl: 1000, vat: 150, receipt_url: null, receipt_path: null, receipt_number: 'BW-123',
  ai_extracted: null, ai_suggestion: null, source: 'receipt', paid: true, stage_id: null, overhead_kind: null, created_at: T0,
}

export const SLIP_RETURN = {
  id: RETURN_ID, expense_id: EXPENSE_ID, project_id: PROJECT_ID, stage_id: null, category: 'materials',
  supplier: 'Builders Warehouse', receipt_number: 'BW-123', bought_on: '2026-10-20',
  items: [{ description: 'Cement 50kg', quantity: 2, unit_price: 115, amount: 230 }],
  amount_incl: 230, status: 'to_return', returned_on: null, credit_number: null, credit_amount_incl: null,
  credit_path: null, credit_expense_id: null, note: null, created_by: USER_ID,
  created_at: '2026-10-21T09:00:00Z', updated_at: '2026-10-21T09:00:00Z',
}

export const CHANGE_REQUEST = {
  id: REQUEST_ID, number: 1, description: 'Bigger buttons on the slip page: they are hard to hit on site.',
  page_path: '/expenses/capture', page_title: 'Snap slip', pane: null, department: 'Money', status: 'new',
  priority: 'normal', admin_note: null, done_in: null, created_by: USER_ID, created_at: '2026-11-01T07:00:00Z',
  decided_by: null, decided_at: null, closed_at: null, tested_ok: null, tested_note: null, tested_at: null,
  tested_by: null, assigned_to: null, review_title: null, review_verdict: null, review_size: null,
  review_summary: null, review_questions: [], reviewed_at: null, build_requested_at: null, build_requested_by: null,
}

/* The Vercel functions' answers the pages need in order to draw (the dev server runs none of them). */
export const API = {
  '/api/portal/staff-list': { users: [] },
}

/** The everyday tables, as rows. A test spreads this and overrides what it is about. */
export function baseDb(profile = ADMIN) {
  return {
    profiles: [profile, ...(profile.id === BOSS.id ? [ADMIN] : [BOSS])],
    company_settings: [SETTINGS],
    companies: [COMPANY],
    contacts: [CONTACT],
    projects: [PROJECT],
    quotes: [QUOTE],
    expenses: [EXPENSE],
  }
}

/** Everything a page needs: the tables, and the /api answers. */
export function backend(profile = ADMIN, { db = {}, api = {}, handlers = [] } = {}) {
  return { db: { ...baseDb(profile), ...db }, api: { ...API, ...api }, handlers }
}

/* ---------- News (Remus · Handover 8): one sent newsletter, one draft, a subscriber, a diary photo the client may see ---------- */

export const NEWS_SENT_ID = '99999999-9999-4999-8999-999999999901'
export const NEWS_DRAFT_ID = '99999999-9999-4999-8999-999999999902'

const NEWS_BASE = {
  kind: 'news', preheader: '', images: [], audience: { kind: 'all_clients' }, created_by: USER_ID,
  created_at: '2026-11-05T08:00:00Z', updated_at: '2026-11-05T08:00:00Z', queued_by: null,
}
export const NEWS_SENT = {
  ...NEWS_BASE, id: NEWS_SENT_ID, name: 'Newsletter October 2026', subject: 'We’ve finished a job in Brooklyn',
  body: 'Hello {{first_name}},\n\nThe kitchen is done.', status: 'sent', recipient_count: 2,
  queued_at: '2026-11-05T09:00:00Z', finished_at: '2026-11-05T09:01:00Z',
}
export const NEWS_DRAFT = {
  ...NEWS_BASE, id: NEWS_DRAFT_ID, name: 'Newsletter November 2026', subject: '', body: '', status: 'draft',
  recipient_count: null, queued_at: null, finished_at: null,
}
export const NEWS_RESULTS = {
  campaign_id: NEWS_SENT_ID, total: 2, queued: 0, accepted: 2, failed: 0, skipped: 0, delivered: 2, delayed: 0,
  bounced: 0, complained: 0, opened: 1, clicked: 0, unsubscribed: 0, opted_in: 0,
}
const SEND_BASE = {
  campaign_id: NEWS_SENT_ID, company_name: 'Test Client (Pty) Ltd', basis: 'Existing client (POPIA soft opt-in)', state: 'sent', error: null,
  sent_at: '2026-11-05T09:00:30Z', delivered_at: '2026-11-05T09:00:40Z', first_clicked_at: null, click_count: 0,
  unsubscribed_at: null, opted_in_at: null, company_id: COMPANY_ID,
}
export const NEWS_SENDS = [
  { ...SEND_BASE, id: 'a1', email: 'client@example.test', first_name: null, first_opened_at: '2026-11-05T10:00:00Z', open_count: 1, contact_id: null },
  { ...SEND_BASE, id: 'a2', email: 'thandi@example.test', first_name: 'Thandi', first_opened_at: null, open_count: 0, contact_id: CONTACT_ID },
]
export const NEWS_SUBSCRIBER = {
  id: '99999999-9999-4999-8999-999999999903', email: 'anna@sub.test', name: 'Anna Signup', company: null, source: 'sign-up page',
  consent_at: '2026-11-03T10:00:00Z', consent_how: 'sign-up page', consent_note: 'Signed up on the news page and confirmed from the email',
  confirm_sent_at: '2026-11-03T09:59:00Z', created_at: '2026-11-03T09:58:00Z',
}
export const NEWS_STOPPED = { email: 'gone@example.test', status: 'undeliverable', how: 'hard bounce', reason: 'Hard bounce: No such user', changed_at: '2026-11-05T09:05:00Z' }
export const DIARY_PHOTO = {
  id: '99999999-9999-4999-8999-999999999904', path: `${PROJECT_ID}/x/photo.jpg`, caption: 'The new kitchen', show_client: true,
  created_at: '2026-11-04T12:00:00Z', project_id: PROJECT_ID, projects: { name: 'Kitchen at 2 Client Road' },
}
/** Sending set up (the domain still to be verified at Resend, which only the send itself finds out). */
export const NEWS_CONFIG_READY = {
  ready: true, missing: [], problem: null, from: 'Urban Haus <news@urbanhausgroup.co.za>', replyTo: 'info@urbanhaus.test',
  webhook: false, steps: [], keyProblem: null,
}

/** The News tables, as rows, for a test to spread into `db`. */
export function newsDb() {
  return {
    marketing_campaigns: [NEWS_SENT, NEWS_DRAFT],
    'rpc/marketing_campaign_results': [NEWS_RESULTS],
    marketing_sends: NEWS_SENDS,
    marketing_subscribers: [NEWS_SUBSCRIBER],
    marketing_preferences: [NEWS_STOPPED],
    marketing_lists: [],
    site_diary_photos: [DIARY_PHOTO],
  }
}
