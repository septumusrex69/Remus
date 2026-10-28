/**
 * THE CLIENT PORTAL'S RULES (Remus · Handoff 5, copied from Raptor H13's src/lib/clientPortal.ts and
 * the parts of its loginCode.ts the portal uses). Pure: the server (api/_lib/portal.ts) and the tests
 * import it.
 *
 * Stephan, 28 Oct: "Client portal can be a good idea. To see their progresses and things."
 *
 * HOW A CLIENT SIGNS IN, AND WHY NOT LIKE STAFF. A client is never a Supabase user (0026): they type
 * their email, are emailed six digits, and the portal server hands their browser a session token. No
 * password to forget or share.
 *
 * WHAT THE CLIENT IS SHOWN -- Raptor's "limited transparency", in a builder's terms: their projects and
 * where each stage stands against the plan, the quotes sent to them, and their invoices with what is
 * paid and still owing. Never costs, markup, profit, the crew or the site diary: those are Urban Haus's
 * side of the job.
 */

/** Ten minutes and five tries, as Raptor's staff and portal codes. */
export const PORTAL_CODE_MINUTES = 10
export const PORTAL_MAX_ATTEMPTS = 5
/** A month signed in: a client looks in now and then; a session that never ends is one left open on a shared PC. */
export const PORTAL_SESSION_DAYS = 30
/** The header the browser sends its session in. Not Authorization, which means a staff token everywhere else. */
export const PORTAL_TOKEN_HEADER = 'x-portal-token'
const RESEND_SECONDS = 60
const MAX_SENDS_PER_HOUR = 5

/** A typed address, as the one form it is stored and looked up in. Null when it is not one. */
export function normalisePortalEmail(typed: unknown): string | null {
  if (typeof typed !== 'string') return null
  const e = typed.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null
}

/** Six digits, however they were typed ("123 456", "123-456"); null otherwise. */
export function normaliseCode(typed: unknown): string | null {
  if (typeof typed !== 'string') return null
  const digits = typed.replace(/[\s-]/g, '')
  return /^\d{6}$/.test(digits) ? digits : null
}

/** A session token: 32 random bytes as hex. Anything else is refused before it is hashed. */
export function isPortalToken(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/**
 * THE SAME ANSWER WHETHER OR NOT THE ADDRESS MAY SIGN IN. A sign-in box that says "we don't know that
 * address" is a way to find out who Urban Haus's clients are, one guess at a time.
 */
export const CODE_SENT_MESSAGE = 'If that address may sign in, a code is on its way. It lasts 10 minutes.'

export type PortalCodeCheck = 'none' | 'expired' | 'used-up' | 'compare'

export function portalCodeCheck(stored: { expiresAt: string; attempts: number } | null, nowMs: number): PortalCodeCheck {
  if (!stored) return 'none'
  if (Date.parse(stored.expiresAt) <= nowMs) return 'expired'
  if (stored.attempts >= PORTAL_MAX_ATTEMPTS) return 'used-up'
  return 'compare'
}

export const PORTAL_CODE_MESSAGE: Record<Exclude<PortalCodeCheck, 'compare'>, string> = {
  /* 'none' reads like a wrong code on purpose: an address with no code waiting is also an address that
     may not sign in, and the two must not be told apart. */
  none: 'That code is not right. Check it, or ask for a new one.',
  expired: `That code has expired (they last ${PORTAL_CODE_MINUTES} minutes). Ask for a new one.`,
  'used-up': 'Too many wrong tries. Ask for a new one.',
}

export interface SendHistory { sentAt: string; windowStartedAt: string; sendsInWindow: number }
export type ResendDecision =
  | { ok: true; windowStartedAt: string; sendsInWindow: number }
  | { ok: false; waitSeconds: number; reason: string }

/** MAY ANOTHER CODE GO NOW? A minute between sends and five in an hour (Raptor's resendDecision). */
export function resendDecision(last: SendHistory | null, nowMs: number): ResendDecision {
  const now = new Date(nowMs).toISOString()
  if (!last) return { ok: true, windowStartedAt: now, sendsInWindow: 1 }
  const sinceSend = (nowMs - Date.parse(last.sentAt)) / 1000
  if (sinceSend < RESEND_SECONDS) {
    const wait = Math.ceil(RESEND_SECONDS - sinceSend)
    return { ok: false, waitSeconds: wait, reason: `A code was sent a moment ago. You can ask for another in ${wait} seconds.` }
  }
  const windowAge = (nowMs - Date.parse(last.windowStartedAt)) / 1000
  if (windowAge >= 3600) return { ok: true, windowStartedAt: now, sendsInWindow: 1 }
  if (last.sendsInWindow >= MAX_SENDS_PER_HOUR) {
    const wait = Math.ceil(3600 - windowAge)
    return { ok: false, waitSeconds: wait, reason: `That is ${MAX_SENDS_PER_HOUR} codes this hour. Try again in ${Math.ceil(wait / 60)} minutes.` }
  }
  return { ok: true, windowStartedAt: last.windowStartedAt, sendsInWindow: last.sendsInWindow + 1 }
}

/**
 * WHO SENDS THE CODE. Remus has no company mailbox that works yet (Resend's domain is not verified), so
 * a person's connected one: the one who invited the client first -- the name they know -- then the
 * Administrators', by name.
 */
export function codeSenderOrder(
  inviterId: string,
  staff: { id: string; name: string; hasMailbox: boolean; active: boolean }[],
): string[] {
  const usable = staff.filter((a) => a.hasMailbox && a.active)
  const own = usable.filter((a) => a.id === inviterId).map((a) => a.id)
  const others = usable.filter((a) => a.id !== inviterId).sort((a, b) => a.name.localeCompare(b.name)).map((a) => a.id)
  return [...own, ...others]
}

/** "Safari on iPhone": enough to recognise a session, nothing more. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  const device = /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua)) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : 'a device'
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'a browser'
  return `${browser} on ${device}`.slice(0, 80)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The code email. The code in the body, not the subject, so a lock screen does not show it. */
export function portalCodeEmail(input: { name: string; code: string; company: string }): { subject: string; html: string; text: string } {
  const first = input.name.trim().split(' ')[0] || 'there'
  const lines = [
    `Hi ${escapeHtml(first)},`,
    `Your code is <b style="font-size:20px;letter-spacing:3px">${escapeHtml(input.code)}</b>. It expires in ${PORTAL_CODE_MINUTES} minutes.`,
    'If you did not ask for it, you can ignore this email: nobody can sign in without the code.',
    escapeHtml(input.company),
  ]
  return {
    subject: `Your ${input.company} client portal code`,
    html: lines.join('<br><br>'),
    text: lines.join('\n\n').replace(/<[^>]+>/g, ''),
  }
}

/** The invitation, from the inviter's own mailbox. */
export function portalInviteEmail(input: { name: string; company: string; url: string }): { subject: string; html: string; text: string } {
  const first = input.name.trim().split(' ')[0] || 'there'
  const url = escapeHtml(input.url)
  const html = [
    `Hi ${escapeHtml(first)},`,
    `You can now follow your building work with ${escapeHtml(input.company)} online: where each stage of your project stands, your quotes, and your invoices with what has been paid.`,
    `Open <a href="${url}">${url}</a> and type this email address. We email you a code each time you sign in; there is no password to remember.`,
  ].join('<br><br>')
  return {
    subject: `Your ${input.company} client portal`,
    html,
    text: html.replace(/<br><br>/g, '\n\n').replace(/<a href="[^"]*">([^<]*)<\/a>/g, '$1').replace(/<[^>]+>/g, ''),
  }
}

/* ------------------------------------------------------------------ what the client sees */

export type StageState = 'done' | 'on' | 'next' | 'unplanned'
export const STAGE_STATE_LABEL: Record<StageState, string> = { done: 'Done', on: 'Under way', next: 'To come', unplanned: 'Not dated yet' }

const dayMs = 86_400_000
const dayOf = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / dayMs

/** Where one stage stands on the plan, by its dates against today (yyyy-mm-dd, Johannesburg). */
export function stageState(s: { start_date: string | null; end_date: string | null }, today: string): StageState {
  if (!s.start_date || !s.end_date) return 'unplanned'
  if (s.end_date < today) return 'done'
  if (s.start_date <= today) return 'on'
  return 'next'
}

/**
 * HOW FAR ALONG THE JOB IS, BY THE PLAN: the stages' days already behind us over all their days. A
 * finished project is 100; a job with no dated stages has no figure rather than a made-up one. It is the
 * calendar, not a site inspection -- the screen says "by the plan".
 */
export function projectProgress(
  status: string,
  stages: { start_date: string | null; end_date: string | null }[],
  today: string,
): number | null {
  if (status === 'completed') return 100
  const dated = stages.filter((s) => s.start_date && s.end_date && s.end_date >= s.start_date)
  if (!dated.length) return null
  const t = dayOf(today)
  let total = 0
  let behind = 0
  for (const s of dated) {
    const a = dayOf(s.start_date!)
    const b = dayOf(s.end_date!)
    const len = b - a + 1
    total += len
    behind += Math.min(len, Math.max(0, t - a + 1))
  }
  return Math.round((behind / total) * 100)
}

/** A project's status in the client's words. Leads and cancelled jobs are not shown at all. */
export const PORTAL_PROJECT_STATUS: Record<string, string> = {
  planned: 'Planned', active: 'Under way', on_hold: 'On hold', completed: 'Finished',
}
/** Quotes the client has been sent; drafts are Urban Haus's own. */
export const PORTAL_QUOTE_STATUS: Record<string, string> = {
  sent: 'Waiting for your answer', accepted: 'Accepted', declined: 'Declined', expired: 'Expired',
}
/** Invoices sent; drafts and cancelled ones are not the client's. */
export const PORTAL_INVOICE_STATUSES = ['sent', 'paid', 'overdue'] as const

/** An invoice as the client sees it: total, paid, still owing. Paid counts payments, not the status word. */
export function portalInvoice(
  i: { number: string | null; issue_date: string; due_date: string | null; description: string | null; amount_excl: number; vat: number; status: string },
  paid: number,
  today: string,
): { number: string; issued: string; due: string | null; description: string; total: number; paid: number; owing: number; state: 'paid' | 'overdue' | 'open' } {
  const total = Math.round((Number(i.amount_excl) + Number(i.vat)) * 100) / 100
  const owing = Math.max(0, Math.round((total - paid) * 100) / 100)
  const state = owing <= 0.005 || i.status === 'paid' ? 'paid' : i.due_date && i.due_date < today ? 'overdue' : 'open'
  return {
    number: i.number ?? '', issued: i.issue_date, due: i.due_date, description: i.description ?? '',
    total, paid: Math.round(paid * 100) / 100, owing: state === 'paid' ? 0 : owing, state,
  }
}

/** Today in Johannesburg, yyyy-mm-dd: the server runs on UTC, and a 01:00 visit is still today here. */
export function todayJhb(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
}
