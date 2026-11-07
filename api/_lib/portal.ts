import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireCaller } from './auth.js'
import { credentialsKeyProblem, hashPassword, keyedHash, passwordMatches, sameHex } from './crypto.js'
import { adminClient, getConnection, sendFromOwnMailbox } from './mailbox.js'
import { buildQuotePdf, QuotePdfError } from './quotePdf.js'
import {
  CODE_SENT_MESSAGE, PORTAL_CODE_MESSAGE, PORTAL_CODE_MINUTES, PORTAL_INVOICE_STATUSES, PORTAL_PASSWORD_LOCK_MINUTES,
  PORTAL_PASSWORD_WRONG, PORTAL_PHOTOS_PER_PROJECT, PORTAL_PROJECT_STATUS, PORTAL_QUOTE_STATUS,
  PORTAL_TOKEN_HEADER, STAGE_STATE_LABEL, cleanPersonName, codeSenderOrder, deviceLabel, isPortalToken, normaliseCode,
  normalisePortalEmail, passwordFailure, portalAcceptNotice, portalCodeCheck, portalCodeEmail, portalInviteEmail, portalInvoice,
  portalPasswordProblem, portalProgressNotes, portalQuoteAcceptProblem, portalSessionDays, projectProgress, resendDecision,
  stageState, todayJhb,
} from './portalRules.js'
import { newsHandler } from './news.js'

/**
 * /api/portal/<action> -- THE CLIENT PORTAL'S SERVER (Remus · Handoff 5, copied from Raptor H13's
 * api/_lib/portal.ts). See portalRules.ts for what a client is shown and why.
 *
 * EVERY READ IS THE SERVICE ROLE, FILTERED BY THE SESSION'S CLIENT. The browser names nothing it may
 * read: not a client, not a project. The client comes off the session row.
 *
 * Two kinds of caller, never mixed:
 *   anonymous    brand, request-code, verify, sign-in          (the code, or the password set after it, is the authority)
 *   portal user  me, overview, sign-out, set-password,          (x-portal-token)
 *                quote-pdf, accept-quote
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
  /* The button goes back to the portal the client asked from, and the email is signed by whoever sends it (Raptor S16). */
  const url = portalUrl(req)
  const nameOf = new Map((staff ?? []).map((p) => [p.id as string, String(p.name ?? '')]))
  let sent = false
  let lastError = 'Nobody at the company has a mailbox connected to send it from.'
  for (const senderId of order) {
    const mail = portalCodeEmail({ name: String(user.name ?? ''), code, company, url, from: nameOf.get(senderId) })
    const r = await sendAs(admin, senderId, { to: user.email as string, subject: mail.subject, html: mail.html, text: mail.text })
    if (r.ok) { sent = true; console.log(`[portal] code for portal user ${user.id} sent from ${senderId}`); break }
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
  const { data: user } = await admin.from('client_portal_users').select('id, active, password_hash').eq('email', email).maybeSingle()
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
  const session = await openSession(admin, req, user!.id, t, body.remember !== false)
  if (!session) { res.status(500).json({ error: 'You could not be signed in just now. Try again.' }); return }
  /* A CODE IS THE FIRST VISIT OR THE RESET (Raptor S16), so the browser asks for a password next: always when
     there is none yet, and when the client came here because they forgot it. The code also clears a lock. */
  await admin.from('client_portal_users').update({ password_failures: 0, password_locked_until: null }).eq('id', user!.id)
  res.status(200).json({ ...session, needsPassword: !user!.password_hash || body.reset === true })
}

/**
 * A new signed-in browser: the token goes to it once, only its keyed hash is kept. KEEP ME SIGNED IN (Raptor
 * S16): ticked, a month; not ticked, a day (portalSessionDays).
 */
async function openSession(admin: SupabaseClient, req: VercelRequest, userId: string, t: number, remember: boolean): Promise<{ token: string; expiresAt: string } | null> {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(t + portalSessionDays(remember) * 86_400_000).toISOString()
  const { error } = await admin.from('client_portal_sessions').insert({
    user_id: userId, token_hash: keyedHash('portal-session', token), expires_at: expiresAt,
    device: deviceLabel(req.headers['user-agent'] as string | undefined),
  })
  if (error) return null
  await admin.from('client_portal_users').update({ last_login_at: new Date(t).toISOString() }).eq('id', userId)
  return { token, expiresAt }
}

/*
 * THE EVERYDAY SIGN-IN (Remus · Handover 8, Raptor S16's signIn): the address and the password set after the
 * first code. One answer for an unknown address, a login with no password yet and a wrong password
 * (PORTAL_PASSWORD_WRONG), for the same reason the code's answer never says whether an address is a client's.
 * Five wrong in a row lock it for a quarter of an hour; the emailed code still opens it.
 */
const signIn: Handler = async (req, res, admin) => {
  const body = req.body ?? {}
  const email = normalisePortalEmail(body.email)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) { res.status(400).json({ error: 'Type your email address and your password.' }); return }
  const { data: user } = await admin.from('client_portal_users')
    .select('id, active, password_hash, password_failures, password_locked_until').eq('email', email).maybeSingle()
  const t = now()
  if (user?.password_locked_until && Date.parse(user.password_locked_until as string) > t) {
    res.status(429).json({ error: `Too many wrong passwords. Try again in ${PORTAL_PASSWORD_LOCK_MINUTES} minutes, or email yourself a code.` }); return
  }
  if (!user || !user.active || !user.password_hash || !passwordMatches(password, user.password_hash as string)) {
    if (user?.password_hash) {
      const f = passwordFailure(Number(user.password_failures ?? 0), t)
      await admin.from('client_portal_users').update({ password_failures: f.failures, password_locked_until: f.lockedUntil }).eq('id', user.id)
      if (f.lockedUntil) console.log(`[portal] password locked for portal user ${user.id}`)
    }
    res.status(400).json({ error: PORTAL_PASSWORD_WRONG }); return
  }
  const session = await openSession(admin, req, user.id as string, t, body.remember !== false)
  if (!session) { res.status(500).json({ error: 'You could not be signed in just now. Try again.' }); return }
  await admin.from('client_portal_users').update({ password_failures: 0, password_locked_until: null }).eq('id', user.id)
  res.status(200).json(session)
}

/*
 * WHO THE SIGN-IN PAGE BELONGS TO, before anybody signs in: the company's name, logo, phone and email from
 * Settings -- what is on every quote anyway. Raptor's sign-in has "Need help signing in?"; this is where it writes to.
 */
const brand: Handler = async (_req, res, admin) => {
  const { data: s } = await admin.from('company_settings').select('name, phone, email, logo_url').eq('id', true).maybeSingle()
  res.status(200).json({ name: s?.name || 'Urban Haus Construction', phone: s?.phone ?? null, email: s?.email ?? null, logoUrl: s?.logo_url ?? null })
}

/** The portal's own address, for the emails' button. */
function portalUrl(req: VercelRequest): string | undefined {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  return host ? `https://${String(host)}/portal` : undefined
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
    admin.from('quotes').select('id, number, title, site_address, status, issue_date, valid_until, accepted_at, accepted_by_name, accepted_via')
      .eq(col, client).in('status', Object.keys(PORTAL_QUOTE_STATUS)).order('issue_date', { ascending: false }),
    admin.from('invoices').select('id, project_id, number, issue_date, due_date, description, amount_excl, vat, status')
      .eq(col, client).in('status', [...PORTAL_INVOICE_STATUSES]).order('issue_date', { ascending: false }),
  ])
  if (projects.error || quotes.error || invoices.error) { res.status(500).json({ error: 'Your projects could not be read just now.' }); return }

  const projectIds = (projects.data ?? []).map((p) => p.id as string)
  const quoteIds = (quotes.data ?? []).map((q) => q.id as string)
  const invoiceIds = (invoices.data ?? []).map((i) => i.id as string)
  const none = Promise.resolve({ data: [], error: null })
  const [stages, totals, payments, diary, photoRows] = await Promise.all([
    projectIds.length
      ? admin.from('project_stages').select('project_id, name, sort_order, start_date, end_date').in('project_id', projectIds).order('sort_order')
      : none,
    quoteIds.length ? admin.from('quote_totals').select('quote_id, total_incl').in('quote_id', quoteIds) : none,
    invoiceIds.length ? admin.from('payments').select('invoice_id, amount').in('invoice_id', invoiceIds) : none,
    /* PART 2 (Remus · Handover 8): only the diary days and photos the office ticked for the client, and of a
       diary day only its date and "Work done" -- delays, safety, materials and the crew are never selected. */
    projectIds.length
      ? admin.from('site_diary_entries').select('project_id, date, work_done').in('project_id', projectIds).eq('show_client', true)
        .order('date', { ascending: false }).limit(500)
      : none,
    projectIds.length
      ? admin.from('site_diary_photos').select('id, project_id, path, caption, created_at, site_diary_entries(date)')
        .in('project_id', projectIds).eq('show_client', true).order('created_at', { ascending: false }).limit(PORTAL_PHOTOS_PER_PROJECT * projectIds.length)
      : none,
  ])

  const paid = new Map<string, number>()
  for (const p of payments.data ?? []) paid.set(p.invoice_id as string, (paid.get(p.invoice_id as string) ?? 0) + Number(p.amount))
  const totalOf = new Map((totals.data ?? []).map((t) => [t.quote_id as string, Number(t.total_incl)]))

  /* The photos, a fair number per project, each opened with a signed link that lasts an hour (the bucket is private). */
  const photosOf = new Map<string, { id: string; path: string; caption: string | null; date: string }[]>()
  for (const r of (photoRows.data ?? []) as unknown as { id: string; project_id: string; path: string; caption: string | null; created_at: string; site_diary_entries: { date: string } | null }[]) {
    const list = photosOf.get(r.project_id) ?? []
    if (list.length >= PORTAL_PHOTOS_PER_PROJECT) continue
    list.push({ id: r.id, path: r.path, caption: r.caption, date: r.site_diary_entries?.date ?? r.created_at.slice(0, 10) })
    photosOf.set(r.project_id, list)
  }
  const paths = [...photosOf.values()].flat().map((p) => p.path)
  const signed = new Map<string, string>()
  if (paths.length) {
    const { data } = await admin.storage.from('site-photos').createSignedUrls(paths, 3600)
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl)
  }
  const diaryRows = (diary.data ?? []) as { project_id: string; date: string; work_done: string | null }[]

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
        notes: portalProgressNotes(diaryRows.filter((d) => d.project_id === p.id)),
        photos: (photosOf.get(p.id as string) ?? [])
          .filter((ph) => signed.has(ph.path))
          .map((ph) => ({ id: ph.id, url: signed.get(ph.path)!, caption: ph.caption, date: ph.date })),
      }
    }),
    quotes: (quotes.data ?? []).map((q) => ({
      /* The id goes to the browser so it can ask for the PDF or accept; the server checks it is this client's every time. */
      id: q.id, number: q.number, title: q.title, siteAddress: q.site_address, issued: q.issue_date, validUntil: q.valid_until,
      total: totalOf.get(q.id as string) ?? null, status: PORTAL_QUOTE_STATUS[q.status as string] ?? q.status,
      canAccept: portalQuoteAcceptProblem(q as { status: string; valid_until: string | null }, { name: 'ok', agreed: true }, today) === null,
      acceptedOnPortal: q.accepted_via === 'portal' ? { by: String(q.accepted_by_name ?? ''), at: q.accepted_at as string } : null,
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

/* SETTING THE PASSWORD (Raptor S16), from a browser the code just signed in. Hashed here, never stored as typed. */
const setPassword: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const password = (req.body ?? {}).password
  const problem = portalPasswordProblem(password, who.email)
  if (problem) { res.status(400).json({ error: problem }); return }
  const { error } = await admin.from('client_portal_users').update({
    password_hash: hashPassword(password as string), password_set_at: new Date(now()).toISOString(),
    password_failures: 0, password_locked_until: null,
  }).eq('id', who.userId)
  if (error) { res.status(500).json({ error: 'Your password could not be saved just now. Try again.' }); return }
  console.log(`[portal] password set for portal user ${who.userId}`)
  res.status(200).json({ ok: true })
}

/* ------------------------------------------------------------------ a signed-in client: quotes (part 2) */

/**
 * ONE OF THIS CLIENT'S QUOTES THAT THEY HAVE BEEN SENT, or null. The browser names the quote; the server checks
 * it belongs to the session's client and is not a draft -- the same filter the overview reads with.
 */
async function ownQuote(admin: SupabaseClient, who: PortalCaller, id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null
  const col = who.companyId ? 'company_id' : 'contact_id'
  const { data } = await admin.from('quotes').select('id, number, title, status, valid_until')
    .eq('id', id).eq(col, (who.companyId ?? who.contactId)!).in('status', Object.keys(PORTAL_QUOTE_STATUS)).maybeSingle()
  return data as { id: string; number: string | null; title: string; status: string; valid_until: string | null } | null
}

/** The quote as the PDF the office sends (api/_lib/quotePdf.ts), for one of the client's own quotes. */
const quotePdf: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const q = await ownQuote(admin, who, (req.body ?? {}).id)
  if (!q) { res.status(404).json({ error: 'That quote could not be found.' }); return }
  try {
    const pdf = await buildQuotePdf(admin, q.id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.status(200).send(Buffer.from(pdf.bytes))
  } catch (e) {
    if (e instanceof QuotePdfError) { res.status(404).json({ error: e.message }); return }
    console.error('[portal] quote PDF failed', e)
    res.status(500).json({ error: 'The PDF could not be made just now. Try again, or ask us to email it.' })
  }
}

/*
 * ACCEPTING A QUOTE (Remus · Handover 8; Raptor has no equivalent). A sent, still-valid quote, the client's
 * name typed and the box ticked (portalQuoteAcceptProblem). The update only lands while the quote is still
 * 'sent', so two clicks -- or the office marking it at the same moment -- cannot both win. Every active
 * Administrator is told in the bell, as the budget alerts are; making the project stays the office's step.
 */
const acceptQuote: Handler = async (req, res, admin) => {
  const who = await requirePortalUser(req, admin)
  if (!who) { res.status(401).json({ error: 'Please sign in again.' }); return }
  const body = req.body ?? {}
  const q = await ownQuote(admin, who, body.id)
  const problem = portalQuoteAcceptProblem(q, { name: body.name, agreed: body.agreed }, todayJhb(now()))
  if (problem) { res.status(q ? 409 : 404).json({ error: problem }); return }
  const name = cleanPersonName(body.name)
  const at = new Date(now()).toISOString()
  const { data: done, error } = await admin.from('quotes').update({
    status: 'accepted', accepted_at: at, accepted_by_name: name, accepted_via: 'portal', accepted_portal_user_id: who.userId, updated_at: at,
  }).eq('id', q!.id).eq('status', 'sent').select('id').maybeSingle()
  if (error) { res.status(500).json({ error: 'Your acceptance could not be saved just now. Try again, or give us a call.' }); return }
  if (!done) { res.status(409).json({ error: 'This quote can no longer be accepted here. Please contact us.' }); return }

  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'Administrator').eq('status', 'Active')
  const message = portalAcceptNotice({ name, client: who.clientName, number: q!.number, title: q!.title })
  if (admins?.length) {
    const { error: nErr } = await admin.from('notifications').insert(admins.map((a) => ({
      user_id: a.id as string, type: 'quote.accepted', message, link: `/quotes/${q!.id}`,
    })))
    if (nErr) console.error(`[portal] quote ${q!.id} accepted, but the bell could not be told: ${nErr.message}`)
  }
  console.log(`[portal] quote ${q!.id} accepted on the portal by portal user ${who.userId}`)
  res.status(200).json({ ok: true, acceptedAt: at })
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
    .select('id, email, name, active, invited_at, last_login_at, password_set_at').eq(client.col, client.id).order('invited_at')
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

  const url = portalUrl(req) ?? '/portal'
  const mail = portalInviteEmail({ name, company: await companyName(admin), url, from: staff.name })
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
  brand,
  'request-code': requestCode,
  verify,
  'sign-in': signIn,
  'set-password': setPassword,
  me,
  overview,
  'quote-pdf': quotePdf,
  'accept-quote': acceptQuote,
  'sign-out': signOut,
  'staff-list': staffList,
  'staff-invite': staffInvite,
  'staff-set-active': staffSetActive,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : ''
  /* NEWS (Remus · Handover 8): its own actions and rules, in api/_lib/news.ts. First, before anything reads the
     body: Resend's webhook needs the bytes it signed. */
  if (action.startsWith('news-')) { await newsHandler(req, res, action); return }
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
