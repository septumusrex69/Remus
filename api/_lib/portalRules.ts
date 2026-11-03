/**
 * THE CLIENT PORTAL'S RULES (Remus · Handoff 5, copied from Raptor H13's src/lib/clientPortal.ts and
 * the parts of its loginCode.ts the portal uses). Pure: the server (api/_lib/portal.ts) and the tests
 * import it.
 *
 * Stephan, 28 Oct: "Client portal can be a good idea. To see their progresses and things."
 *
 * HOW A CLIENT SIGNS IN, AND WHY NOT LIKE STAFF. A client is never a Supabase user (0026). Since Remus ·
 * Handover 8 (Raptor S16) they sign in with their email and a PASSWORD; the emailed six digits are only the
 * first visit (then they choose a password) and the "forgot your password". Either way the portal server
 * hands their browser a session token.
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

/*
 * A PASSWORD, AFTER THE FIRST CODE (Remus · Handover 8, copied from Raptor S16's clientPortal.ts). Raptor's
 * Stephan: "Should I get a code every time? ... Maybe the first time, but ... if you have a password, then that's
 * fine." The code proves the address once and stays as the reset; every other visit is the address and a
 * password. Length is the rule, not a recipe of symbols -- a long phrase a person remembers beats "P@ssw0rd!" --
 * and the address itself is refused, being the first guess anybody makes.
 */
export const PORTAL_PASSWORD_MIN = 8
export const PORTAL_PASSWORD_FAILURES = 5
export const PORTAL_PASSWORD_LOCK_MINUTES = 15
/** The same answer for an unknown address, a login with no password yet and a wrong password. */
export const PORTAL_PASSWORD_WRONG = 'That email address and password do not match. Forgot it, or first time here? Email yourself a code.'

/** Why a chosen password will not do, in words for the client; null when it will. */
export function portalPasswordProblem(password: unknown, email: string | null): string | null {
  if (typeof password !== 'string' || password.length < PORTAL_PASSWORD_MIN) return `Use at least ${PORTAL_PASSWORD_MIN} characters.`
  if (password.length > 200) return 'That is longer than a password needs to be.'
  if (/^(.)\1*$/.test(password)) return 'Use more than one character, repeated.'
  if (email && password.trim().toLowerCase() === email.toLowerCase()) return 'Use something other than your email address.'
  return null
}

/**
 * KEEP ME SIGNED IN (Raptor S16): ticked, a month; not ticked, a day -- and the browser keeps it for the tab only.
 * The server must not hold a month-long key for a shared office PC.
 */
export function portalSessionDays(remember: boolean): number {
  return remember ? PORTAL_SESSION_DAYS : 1
}

/** After five wrong passwords in a row, locked for a quarter of an hour (the counter starts again). */
export function passwordFailure(failuresBefore: number, nowMs: number): { failures: number; lockedUntil: string | null } {
  const failures = failuresBefore + 1
  return failures >= PORTAL_PASSWORD_FAILURES
    ? { failures: 0, lockedUntil: new Date(nowMs + PORTAL_PASSWORD_LOCK_MINUTES * 60_000).toISOString() }
    : { failures, lockedUntil: null }
}

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

/*
 * THE PORTAL'S EMAILS (Remus · Handover 8, after Raptor S16's portalEmailHtml: "the link should be like a thing,
 * like press here"). One layout for both: a band with the company's name in tracked capitals (TEXT, not a
 * picture -- a mail client that blocks images still shows who it is from), the message, the code in a box of its
 * own where there is one, and a BUTTON to the portal. Tables and inline styles only, because that is all Outlook
 * draws. An email cannot read the skins, so the colours are the brand board's (graphite, stone, paper), written
 * out here.
 */
const MAIL = { ink: '#2B2F33', graphite: '#454B50', stone: '#EEEAE4', paper: '#FAF9F6', line: '#DDD8D0', muted: '#6B7075' }
const MAIL_FONT = 'Inter, Arial, Helvetica, sans-serif'

export function portalEmailHtml(input: { company: string; lines: string[]; code?: string; codeNote?: string; button?: { url: string; label: string }; signOff: string }): string {
  const p = (html: string) => `<p style="margin:0 0 16px;font-family:${MAIL_FONT};font-size:15px;line-height:1.55;color:${MAIL.ink}">${html}</p>`
  const code = input.code ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr>
          <td style="background:${MAIL.stone};border:1px solid ${MAIL.line};border-radius:10px;padding:16px 28px;font-family:Consolas,'Courier New',monospace;font-size:30px;font-weight:bold;letter-spacing:8px;color:${MAIL.ink}">${escapeHtml(input.code)}</td>
        </tr></table>${input.codeNote ? p(`<span style="color:${MAIL.muted};font-size:13px">${input.codeNote}</span>`) : ''}` : ''
  const button = input.button ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr>
          <td style="background:${MAIL.graphite};border-radius:8px">
            <a href="${escapeHtml(input.button.url)}" style="display:inline-block;padding:13px 26px;font-family:${MAIL_FONT};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none">${escapeHtml(input.button.label)} &rarr;</a>
          </td>
        </tr></table>` : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MAIL.paper};padding:24px 0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid ${MAIL.line};border-radius:12px;overflow:hidden">
    <tr><td style="background:${MAIL.graphite};padding:22px 32px">
      <div style="font-family:${MAIL_FONT};font-size:13px;letter-spacing:4px;font-weight:bold;color:#FFFFFF">${escapeHtml(input.company.toUpperCase())}</div>
      <div style="font-family:${MAIL_FONT};font-size:11px;letter-spacing:2px;color:${MAIL.stone};margin-top:4px">CLIENT PORTAL</div>
    </td></tr>
    <tr><td style="padding:30px 32px 14px">
        ${input.lines.map(p).join('\n        ')}${code}${button}
        ${p(input.signOff)}
    </td></tr>
  </table>
</td></tr></table>`
}

/** Plain text beside the HTML, for mail clients that show no HTML. */
function plainOf(parts: string[]): string {
  return parts.join('\n\n').replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
}

/** The code email: the first visit, or a forgotten password. The code in the body, not the subject, so a lock screen does not show it. */
export function portalCodeEmail(input: { name: string; code: string; company: string; url?: string; from?: string }): { subject: string; html: string; text: string } {
  const first = input.name.trim().split(' ')[0] || 'there'
  const lines = [`Hi ${escapeHtml(first)},`, 'Here is your code to sign in to the client portal:']
  const codeNote = `It works once, for ${PORTAL_CODE_MINUTES} minutes. Next you choose a password, so you will not need a code to sign in again.`
  const signOff = `If you did not ask for this code, you can ignore this email: nobody can sign in without it.<br><br>Kind regards<br>${input.from ? `${escapeHtml(input.from)}<br>` : ''}${escapeHtml(input.company)}`
  return {
    subject: `Your ${input.company} client portal code`,
    html: portalEmailHtml({
      company: input.company, lines, code: input.code, codeNote,
      button: input.url ? { url: input.url, label: 'Open the client portal' } : undefined, signOff,
    }),
    text: plainOf([...lines, input.code, codeNote, ...(input.url ? [input.url] : []), signOff]),
  }
}

/** The invitation, from the inviter's own mailbox. */
export function portalInviteEmail(input: { name: string; company: string; url: string; from?: string }): { subject: string; html: string; text: string } {
  const first = input.name.trim().split(' ')[0] || 'there'
  const lines = [
    `Hi ${escapeHtml(first)},`,
    `You can now follow your building work with ${escapeHtml(input.company)} online: where each stage of your project stands, photos from site, your quotes, and your invoices with what has been paid.`,
    'Press the button below and type this email address. The first time, we email you a code and you choose a password; after that you sign in with your password.',
  ]
  const signOff = `Kind regards<br>${input.from ? `${escapeHtml(input.from)}<br>` : ''}${escapeHtml(input.company)}`
  return {
    subject: `Your ${input.company} client portal`,
    html: portalEmailHtml({ company: input.company, lines, button: { url: input.url, label: 'Open the client portal' }, signOff }),
    text: plainOf([...lines, input.url, signOff]),
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

/* ------------------------------------------------------------------ portal part 2 (Remus · Handover 8) */

/*
 * PROGRESS NOTES AND SITE PHOTOS. Stephan's portal: "To see their progresses and things." Only what the office
 * ticked for the client: a site diary day with "Show to the client" ticked gives its "Work done" (never delays,
 * safety, materials or the crew count), and a photo with "Client sees" ticked. The newest first, a fair number
 * per project -- a phone is not a place for two years of diary.
 */
export const PORTAL_NOTES_PER_PROJECT = 30
export const PORTAL_PHOTOS_PER_PROJECT = 60

export function portalProgressNotes(
  entries: { date: string; work_done: string | null }[],
  limit = PORTAL_NOTES_PER_PROJECT,
): { date: string; text: string }[] {
  return entries
    .map((e) => ({ date: e.date, text: (e.work_done ?? '').trim() }))
    .filter((e) => e.text.length > 0)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit)
}

/*
 * ACCEPTING A QUOTE ON THE PORTAL. Raptor has nothing like it (a debt book has no quote to accept), so this is
 * Remus's own, in the portal's style: a quote that was SENT, still valid, the client's full name typed and the
 * box ticked. Who and when are kept on the quote, and the Administrators are told in the bell -- turning it into a
 * project stays the office's step (Convert to project), because that sets the budget.
 */
export function cleanPersonName(typed: unknown): string {
  return typeof typed === 'string' ? typed.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
}

export function portalQuoteAcceptProblem(
  quote: { status: string; valid_until: string | null } | null,
  input: { name: unknown; agreed: unknown },
  today: string,
): string | null {
  if (!quote) return 'That quote could not be found.'
  if (quote.status === 'accepted') return 'This quote has already been accepted. Thank you.'
  if (quote.status !== 'sent') return 'This quote can no longer be accepted here. Please contact us.'
  if (quote.valid_until && quote.valid_until < today) return 'This quote is past its valid-until date. Ask us for an updated one.'
  if (cleanPersonName(input.name).length < 2) return 'Type your full name.'
  if (input.agreed !== true) return 'Tick the box to say you accept the quote and its terms.'
  return null
}

/** The bell's line for the Administrators. */
export function portalAcceptNotice(input: { name: string; client: string; number: string | null; title: string }): string {
  const what = [input.number, input.title].filter(Boolean).join(' · ') || 'a quote'
  const who = input.client && input.client !== input.name ? `${input.name} (${input.client})` : input.name
  return `${who} accepted quote ${what} on the client portal. Convert it to a project when you are ready.`
}
