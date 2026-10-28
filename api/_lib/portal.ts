import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireCaller } from './auth.js'
import { credentialsKeyProblem, keyedHash, sameHex } from './crypto.js'
import { adminClient, getConnection, sendFromOwnMailbox } from './mailbox.js'
import {
  CODE_SENT_MESSAGE, PORTAL_CODE_MESSAGE, PORTAL_CODE_MINUTES, PORTAL_INVOICE_STATUSES, PORTAL_PROJECT_STATUS, PORTAL_QUOTE_STATUS,
  PORTAL_SESSION_DAYS, PORTAL_TOKEN_HEADER, STAGE_STATE_LABEL, codeSenderOrder, deviceLabel, isPortalToken, normaliseCode,
  normalisePortalEmail, portalCodeCheck, portalCodeEmail, portalInviteEmail, portalInvoice, projectProgress, resendDecision,
  stageState, todayJhb,
} from './portalRules.js'

/**
 * /api/portal/<action> -- THE CLIENT PORTAL'S SERVER (Remus · Handoff 5, copied from Raptor H13's
 * api/_lib/portal.ts). See portalRules.ts for what a client is shown and why.
 *
 * EVERY READ IS THE SERVICE ROLE, FILTERED BY THE SESSION'S CLIENT. The browser names nothing it may
 * read: not a client, not a project. The client comes off the session row.
 *
 * Two kinds of caller, never mixed:
 *   anonymous    request-code, verify                          (the code is the authority)
 *   portal user  me, overview, sign-out                         (x-portal-token)
 *   staff        staff-list, staff-invite, staff-set-active     (a Remus session, active, not Read Only)
 */

/*
 * ADDRESSES ARE LOOKED UP EXACTLY (eq, not ilike). Every address is stored as normalisePortalEmail makes
 * it (trimmed, lower case), and a typed one is normalised the same way -- whereas ilike would read a typed
 * "_" or "%" as a wildcard and match somebody else's address. (Raptor's portal uses ilike; told.)
 */
type Handler = (req: VercelRequest, res: VercelResponse, admin: SupabaseClient) => Promise<void>

const now = () => Date.now()

async function companyName(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.from('company_settings').select('name').eq('id', true).maybeSingle()
  return String(data?.name || 'Urban Haus Construction')
}

/** Sends from a person's connected mailbox, with their signature. False when they have none or it failed. */
async function sendAs(admin: SupabaseClient, userId: string, msg: { to: string; subject: string; html: string; text: string }): Promise<{ ok: boolean; error: string }> {
  const conn = await getConnection(admin, userId)
  if (!conn) return { ok: false, error: 'no mailbox connected' }
  const { data: me } = await admin.from('profiles')
    .select('name, email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align').eq('id', userId).maybeSingle()
  try {
    await sendFromOwnMailbox(conn, me, { to: [msg.to], cc: [], subject: msg.subject, html: msg.html, text: msg.text, attachments: [] })
    return { ok: true, error: '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/* ------------------------------------------------------------------ anonymous: the sign-in */

const requestCode: Handler = async (req, res, admin) => {
  const email = normalisePortalEmail((req.body ?? {}).email)
  if (!email) { res.status(400).json({ error: 'Type the email address you were invited with.' }); return }
  const { data: user } = await admin.from('client_portal_users')
    .select('id, name, email, active, invited_by').eq('email', email).maybeSingle()
  /* THE SAME ANSWER FOR AN ADDRESS THAT MAY NOT SIGN IN -- see CODE_SENT_MESSAGE. */
  if (!user || !user.active) { res.status(200).json({ message: CODE_SENT_MESSAGE }); return }

  const t = now()
  const { data: last } = await admin.from('client_portal_codes')
    .select('sent_at, window_started_at, sends_in_window').eq('user_id', user.id).maybeSingle()
  const decision = resendDecision(last ? {
    sentAt: last.sent_at as string, windowStartedAt: last.window_started_at as string, sendsInWindow: Number(last.sends_in_window ?? 0),
  } : null, t)
  if (!decision.ok) { res.status(429).json({ error: decision.reason, waitSeconds: decision.waitSeconds }); return }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const { error: saveErr } = await admin.from('client_portal_codes').upsert({
    user_id: user.id, code_hash: keyedHash('portal-code', `${user.id}:${code}`),
    expires_at: new Date(t + PORTAL_CODE_MINUTES * 60_000).toISOString(), attempts: 0,
    sent_at: new Date(t).toISOString(), window_started_at: decision.windowStartedAt, sends_in_window: decision.sendsInWindow,
  }, { onConflict: 'user_id' })
  if (saveErr) { res.status(500).json({ error: 'The code could not be made just now. Try again in a minute.' }); return }

  const [{ data: staff }, { data: boxes }, company] = await Promise.all([
    admin.from('profiles').select('id, name, status, role').or(`role.eq.Administrator${user.invited_by ? `,id.eq.${user.invited_by}` : ''}`),
    admin.from('email_connections').select('user_id'),
    companyName(admin),
  ])
  const withMailbox = new Set((boxes ?? []).map((b) => b.user_id as string))
  const order = codeSenderOrder((user.invited_by as string | null) ?? '', (staff ?? []).map((p) => ({
    id: p.id as string, name: String(p.name ?? ''), hasMailbox: withMailbox.has(p.id as string), active: p.status === 'Active',
  })))
  const mail = portalCodeEmail({ name: String(user.name ?? ''), code, company })
  let sent = false
  let lastError = 'Nobody at the company has a mailbox connected to send it from.'
  for (const senderId of order) {
    const r = await sendAs(admin, senderId, { to: user.email as string, subject: mail.subject, html: mail.html, text: mail.text })
    if (r.ok) { sent = true; break }
    lastError = r.error
  }
  if (!sent) {
    await admin.from('client_portal_codes').update({ expires_at: new Date(t).toISOString() }).eq('user_id', user.id)
    console.error(`[portal] no mailbox would send a code for portal user ${user.id}: ${lastError}`)
    res.status(502).json({ error: 'The code could not be emailed just now. Try again shortly, or give us a call.' }); return
  }
  res.status(200).json({ message: CODE_SENT_MESSAGE })
}

const verify: Handler = async (req, res, admin) => {
  const body = req.body ?? {}
  const email = normalisePortalEmail(body.email)
  const code = normaliseCode(body.code)
  if (!email || !code) { res.status(400).json({ error: 'Type the six digits from the email.' }); return }
  const { data: user } = await admin.from('client_portal_users').select('id, active').eq('email', email).maybeSingle()
  const { data: stored } = user?.active
    ? await admin.from('client_portal_codes').select('code_hash, expires_at, attempts').eq('user_id', user.id).maybeSingle()
    : { data: null }
  const t = now()
  const check = portalCodeCheck(stored ? { expiresAt: stored.expires_at as string, attempts: Number(stored.attempts) } : null, t)
  if (check !== 'compare') { res.status(400).json({ error: PORTAL_CODE_MESSAGE[check] }); return }
  if (!sameHex(stored!.code_hash as string, keyedHash('portal-code', `${user!.id}:${code}`))) {
    await admin.from('client_portal_codes').update({ attempts: Number(stored!.attempts) + 1 }).eq('user_id', user!.id)
    res.status(400).json({ error: PORTAL_CODE_MESSAGE.none }); return
  }

  /* Spent the moment it matches, so the same six digits cannot open a second browser. */
  await admin.from('client_portal_codes').delete().eq('user_id', user!.id)
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(t + PORTAL_SESSION_DAYS * 86_400_000).toISOString()
  const { error } = await admin.from('client_portal_sessions').insert({
    user_id: user!.id, token_hash: keyedHash('portal-session', token), expires_at: expiresAt,
    device: deviceLabel(req.headers['user-agent'] as string | undefined),
  })
  if (error) { res.status(500).json({ error: 'You could not be signed in just now. Try again.' }); return }
  await admin.from('client_portal_users').update({ last_login_at: new Date(t).toISOString() }).eq('id', user!.id)
  res.status(200).json({ token, expiresAt })
}

/* ------------------------------------------------------------------ a signed-in client */

interface PortalCaller {
  userId: string; sessionId: string; name: string; email: string
  /** Exactly one is set: the client is a company or a private person. */
  companyId: string | null; contactId: string | null; clientName: string
}

async function requirePortalUser(req: VercelRequest, admin: SupabaseClient): Promise<PortalCaller | null> {
  const token = req.headers[PORTAL_TOKEN_HEADER]
  if (!isPortalToken(token)) return null
  const { data: s } = await admin.from('client_portal_sessions')
    .select('id, user_id, expires_at').eq('token_hash', keyedHash('portal-session', token)).maybeSingle()
  if (!s || Date.parse(s.expires_at as string) <= now()) return null
  const { data: u } = await admin.from('client_portal_users')
    .select('id, name, email, active, company_id, contact_id, companies(name), contacts(first_name, last_name)').eq('id', s.user_id).maybeSingle()
  /* SWITCHED OFF IS SIGNED OUT, at once: the session is checked against the user every call. */
  if (!u || !u.active) return null
  await admin.from('client_portal_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', s.id)
  const company = u.companies as unknown as { name: string } | null
  const person = u.contacts as unknown as { first_name: string | null; last_name: string | null } | null
  return {
    userId: u.id as string, sessionId: s.id as string, name: String(u.name ?? ''), email: u.email as string,
    companyId: (u.company_id as string | null) ?? null, contactId: (u.contact_id as string | null) ?? null,
    clientName: company?.name ?? [person?.first_name, person?.last_name].filter(Boolean).join(' '),
  }
}

const me: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const { data: s } = await admin.from('company_settings').select('name, phone, email, logo_url').eq('id', true).maybeSingle()
  res.status(200).json({
    name: who.name, email: who.email, client: who.clientName,
    company: { name: s?.name || 'Urban Haus Construction', phone: s?.phone ?? null, email: s?.email ?? null, logoUrl: s?.logo_url ?? null },
  })
}

/**
 * EVERYTHING THE CLIENT MAY SEE, IN ONE ANSWER: their projects with each stage's place on the plan,
 * the quotes sent to them, and their invoices. Only the columns named here leave the server -- a
 * column the browser receives is a column the client can read, so no cost, markup or note is selected.
 */
const overview: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const col = who.companyId ? 'company_id' : 'contact_id'
  const client = (who.companyId ?? who.contactId)!
  const today = todayJhb(now())

  const [projects, quotes, invoices] = await Promise.all([
    admin.from('projects').select('id, name, code, site_address, status, start_date, end_date')
      .eq(col, client).in('status', Object.keys(PORTAL_PROJECT_STATUS)).order('start_date', { ascending: false, nullsFirst: false }),
    admin.from('quotes').select('id, number, title, site_address, status, issue_date, valid_until')
      .eq(col, client).in('status', Object.keys(PORTAL_QUOTE_STATUS)).order('issue_date', { ascending: false }),
    admin.from('invoices').select('id, project_id, number, issue_date, due_date, description, amount_excl, vat, status')
      .eq(col, client).in('status', [...PORTAL_INVOICE_STATUSES]).order('issue_date', { ascending: false }),
  ])
  if (projects.error || quotes.error || invoices.error) { res.status(500).json({ error: 'Your projects could not be read just now.' }); return }

  const projectIds = (projects.data ?? []).map((p) => p.id as string)
  const quoteIds = (quotes.data ?? []).map((q) => q.id as string)
  const invoiceIds = (invoices.data ?? []).map((i) => i.id as string)
  const [stages, totals, payments] = await Promise.all([
    projectIds.length
      ? admin.from('project_stages').select('project_id, name, sort_order, start_date, end_date').in('project_id', projectIds).order('sort_order')
      : Promise.resolve({ data: [], error: null }),
    quoteIds.length ? admin.from('quote_totals').select('quote_id, total_incl').in('quote_id', quoteIds) : Promise.resolve({ data: [], error: null }),
    invoiceIds.length ? admin.from('payments').select('invoice_id, amount').in('invoice_id', invoiceIds) : Promise.resolve({ data: [], error: null }),
  ])

  const paid = new Map<string, number>()
  for (const p of payments.data ?? []) paid.set(p.invoice_id as string, (paid.get(p.invoice_id as string) ?? 0) + Number(p.amount))
  const totalOf = new Map((totals.data ?? []).map((t) => [t.quote_id as string, Number(t.total_incl)]))

  res.status(200).json({
    today,
    projects: (projects.data ?? []).map((p) => {
      const mine = (stages.data ?? []).filter((s) => s.project_id === p.id) as { name: string; start_date: string | null; end_date: string | null }[]
      const ends = mine.map((s) => s.end_date).filter((d): d is string => !!d).sort()
      const starts = mine.map((s) => s.start_date).filter((d): d is string => !!d).sort()
      return {
        id: p.id, name: p.name, code: p.code, siteAddress: p.site_address,
        status: PORTAL_PROJECT_STATUS[p.status as string] ?? p.status,
        start: starts[0] ?? p.start_date ?? null, finish: ends[ends.length - 1] ?? p.end_date ?? null,
        progress: projectProgress(p.status as string, mine, today),
        stages: mine.map((s) => {
          const state = stageState(s, today)
          return { name: s.name || 'General', start: s.start_date, end: s.end_date, state, stateLabel: STAGE_STATE_LABEL[state] }
        }),
      }
    }),
    quotes: (quotes.data ?? []).map((q) => ({
      number: q.number, title: q.title, siteAddress: q.site_address, issued: q.issue_date, validUntil: q.valid_until,
      total: totalOf.get(q.id as string) ?? null, status: PORTAL_QUOTE_STATUS[q.status as string] ?? q.status,
    })),
    invoices: (invoices.data ?? []).map((i) => ({
      ...portalInvoice(i as never, paid.get(i.id as string) ?? 0, today),
      project: (projects.data ?? []).find((p) => p.id === i.project_id)?.name ?? null,
    })),
  })
}

const signOut: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (who) await admin.from('client_portal_sessions').delete().eq('id', who.sessionId)
  res.status(200).json({ ok: true })
}

/* ------------------------------------------------------------------ staff: who may sign in */

/** Anybody active at Urban Haus who may write (not Read Only): they are the ones who deal with clients. */
async function requireStaff(req: VercelRequest, res: VercelResponse, admin: SupabaseClient) {
  const caller = await requireCaller(req)
  if (!caller) { res.status(401).json({ error: 'Please sign in again.' }); return null }
  const { data: p } = await admin.from('profiles').select('id, name, role, status').eq('id', caller.user.id).maybeSingle()
  if (!p || p.status !== 'Active' || p.role === 'Read Only') {
    res.status(403).json({ error: 'Your access is read-only, so you cannot give clients portal access.' }); return null
  }
  return { id: p.id as string, name: String(p.name ?? '') }
}

/** Which client the staff screen means: a company or a private person, never both. */
function clientOf(body: Record<string, unknown>): { col: 'company_id' | 'contact_id'; id: string } | null {
  if (typeof body.companyId === 'string' && body.companyId) return { col: 'company_id', id: body.companyId }
  if (typeof body.contactId === 'string' && body.contactId) return { col: 'contact_id', id: body.contactId }
  return null
}

const staffList: Handler = async (req, res, admin) => {
  if (!(await requireStaff(req, res, admin))) return
  const client = clientOf(req.body ?? {})
  if (!client) { res.status(400).json({ error: 'Which client?' }); return }
  const { data, error } = await admin.from('client_portal_users')
    .select('id, email, name, active, invited_at, last_login_at').eq(client.col, client.id).order('invited_at')
  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(200).json({ users: data ?? [] })
}

const staffInvite: Handler = async (req, res, admin) => {
  const staff = await requireStaff(req, res, admin)
  if (!staff) return
  const body = req.body ?? {}
  const client = clientOf(body)
  const email = normalisePortalEmail(body.email)
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (!client || !email) { res.status(400).json({ error: 'Type the email address of the person to invite.' }); return }
  const { data: found } = client.col === 'company_id'
    ? await admin.from('companies').select('id').eq('id', client.id).maybeSingle()
    : await admin.from('contacts').select('id').eq('id', client.id).maybeSingle()
  if (!found) { res.status(404).json({ error: 'That client could not be found.' }); return }

  const { data: existing } = await admin.from('client_portal_users').select('id, company_id, contact_id').eq('email', email).maybeSingle()
  if (existing && existing[client.col] !== client.id) {
    res.status(409).json({ error: 'That address can already sign in for another client. One address, one client.' }); return
  }
  const row = existing
    ? await admin.from('client_portal_users').update({ active: true, ...(name ? { name } : {}) }).eq('id', existing.id).select('id').single()
    : await admin.from('client_portal_users').insert({ [client.col]: client.id, email, name, invited_by: staff.id }).select('id').single()
  if (row.error) { res.status(500).json({ error: row.error.message }); return }

  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const url = `https://${String(host)}/portal`
  const mail = portalInviteEmail({ name, company: await companyName(admin), url })
  const sent = await sendAs(admin, staff.id, { to: email, subject: mail.subject, html: mail.html, text: mail.text })
  /* Access is given either way; an invitation that did not go is said, not hidden. */
  res.status(200).json({ id: row.data.id, emailed: sent.ok, emailError: sent.ok ? null : sent.error, url })
}

const staffSetActive: Handler = async (req, res, admin) => {
  if (!(await requireStaff(req, res, admin))) return
  const body = req.body ?? {}
  if (typeof body.id !== 'string' || typeof body.active !== 'boolean') { res.status(400).json({ error: 'Which person?' }); return }
  const { error } = await admin.from('client_portal_users').update({ active: body.active }).eq('id', body.id)
  if (error) { res.status(500).json({ error: error.message }); return }
  /* Switched off signs them out everywhere now, not in thirty days. */
  if (!body.active) await admin.from('client_portal_sessions').delete().eq('user_id', body.id)
  res.status(200).json({ ok: true })
}

export const PORTAL_ROUTES: Record<string, Handler> = {
  'request-code': requestCode,
  verify,
  me,
  overview,
  'sign-out': signOut,
  'staff-list': staffList,
  'staff-invite': staffInvite,
  'staff-set-active': staffSetActive,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  /* hasOwnProperty: `?action=constructor` must not find Object.prototype's. */
  const route = Object.prototype.hasOwnProperty.call(PORTAL_ROUTES, action) ? PORTAL_ROUTES[action] : undefined
  if (!route) { res.status(404).json({ error: `Unknown portal route: ${action || '(none)'}` }); return }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(501).json({ error: 'The portal is not set up yet: add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.' }); return }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  await route(req, res, admin)
}
