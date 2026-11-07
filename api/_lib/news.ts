import crypto from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireCaller } from './auth.js'
import { credentialsKeyProblem, keyedHash, sameHex } from './crypto.js'
import { adminClient } from './mailbox.js'
import {
  INVITATION_AUDIENCES, MAX_ATTEMPTS, RESEND_BATCH_MAX, RESEND_MIN_GAP_MS, SENDER_SETUP_STEPS, bounceOutcome, cleanPictures,
  confirmEmail, deliveryEvent, isSendableEmail, isSetupRefusal, mailDomainOf, maskEmail, newsSender, normaliseEmail,
  parseAudience, parseKind, planImport, plainResendError, readCsv, readSubscriberSheet, renderNewsEmail, resolveAudience,
  sendBlockReason, unknownMergeFields, verifySvix, type AudienceResult, type CampaignKind, type ImportRow, type ResendEvent,
} from './newsRules.js'

/**
 * NEWS ON THE SERVER: the sender, the list, the queue, the send, and the no-login pages' answers
 * (Remus · Handover 8, 7 Nov 2026; copied from Raptor's api/_lib/marketing.ts, api/_lib/email/marketing.ts,
 * unsubscribe.ts, optIn.ts and resendWebhook.ts, S10 21-22 Oct, and adapted to Remus).
 *
 * Stephan, 7 Nov: newsletters to clients "with sign-up and unsubscribe", e.g. "We've finished a job in Brooklyn".
 *
 * ON THE PORTAL'S DOOR, /api/portal/news-<action>: api/ is near Vercel's function limit, so News adds actions to an
 * existing multi-action endpoint rather than a file of its own (api/_lib/portal.ts hands every news-* action here).
 *
 *   Administrators (a Remus session, active, role Administrator):
 *     news-config               is the sender set up, and if not, what is missing
 *     news-preview              { audience, kind } how many, a sample, and who was left out and why
 *     news-render               { campaign } the email exactly as it will be sent, for the screen's preview
 *     news-test                 { campaignId } the newsletter to the person pressing it, marked [Test]
 *     news-queue / news-drain   draw the list and send it, a chunk at a time, while the page is open
 *     news-cancel               stop what has not gone yet
 *     news-import-preview       { csv } what an imported list would add
 *     news-import               { csv, name, fileName, consentNote } ...and adding it
 *     news-diary-photo          { photoId } a site diary photo (ticked "show the client") copied into the public
 *                               news-pictures store, so a mail program can show it
 *   Anybody (the signed token, or Resend's signature, is the whole of the authority):
 *     news-unsubscribe          the link in every email, and a mail program's own Unsubscribe button (RFC 8058)
 *     news-opt-in               "Yes, keep me informed": the invitation's button and the sign-up's confirmation
 *     news-sign-up              the public sign-up page: records a sign-up and emails the confirmation
 *     news-resend-webhook       what happened to each email after it left
 *
 * THROUGH RESEND, from the company sender (EMAIL_FROM, or MARKETING_FROM if set) -- never from anybody's own
 * mailbox: a mailbox provider throttles five hundred newsletters from one person, and Resend handles bounces and
 * complaints as a bulk sender must (Raptor's reasoning).
 *
 * NOTHING HERE PRETENDS (Raptor). Not set up -> the config says what is missing, the queue refuses, nothing goes.
 * Domain not verified at Resend yet (urbanhausgroup.co.za, 7 Nov) -> the first send is refused by Resend, and the
 * screen says so in plain words; the newsletter goes back to a draft, nothing half-sent.
 */
type Handler = (req: VercelRequest, res: VercelResponse, admin: SupabaseClient) => Promise<void>

/* ------------------------------------------------------------------------------------------------ settings */

interface Company { name: string; address: string | null; email: string | null; logoUrl: string | null }

async function company(admin: SupabaseClient): Promise<Company> {
  const { data } = await admin.from('company_settings').select('name, address, email, logo_url').eq('id', true).maybeSingle()
  return {
    name: String(data?.name || 'Urban Haus Construction'),
    address: (data?.address as string | null)?.trim() || null,
    email: (data?.email as string | null)?.trim() || null,
    logoUrl: (data?.logo_url as string | null) || null,
  }
}

export interface SenderConfig {
  ready: boolean
  missing: string[]
  problem: string | null
  from: string | null
  replyTo: string | null
  webhook: boolean
  steps: readonly string[]
}

async function senderConfig(admin: SupabaseClient): Promise<SenderConfig> {
  const missing = [
    ...(!process.env.RESEND_API_KEY?.trim() ? ['RESEND_API_KEY'] : []),
    ...(!(process.env.MARKETING_FROM || process.env.EMAIL_FROM)?.trim() ? ['EMAIL_FROM'] : []),
  ]
  const sender = newsSender(process.env)
  const problem = missing.length === 0 && 'error' in sender ? sender.error : null
  const replyTo = process.env.MARKETING_REPLY_TO?.trim() || (await company(admin)).email
  return {
    ready: missing.length === 0 && !problem, missing, problem, from: 'from' in sender ? sender.from : null, replyTo,
    webhook: !!process.env.RESEND_WEBHOOK_SECRET?.trim(), steps: SENDER_SETUP_STEPS,
  }
}

/** The site the links in an email open: the deployment's own, so a preview's link finds the preview's rows. */
function originFor(req: VercelRequest): string | null {
  const own = process.env.PUBLIC_SITE_URL?.trim()
  if (own) return own.replace(/\/$/, '')
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const h = Array.isArray(host) ? host[0] : host
  if (!h) return null
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)
  return `${local ? 'http' : 'https'}://${h}`
}

/* ------------------------------------------------------------------------------------------------ tokens */

/**
 * NO LOGIN AND NO ROW (Raptor's unsubscribe token). The address itself and a keyed hash over it: needs nothing
 * stored, never expires (a link in a two-year-old newsletter must still work), cannot be made for somebody else.
 */
export function unsubscribeToken(email: string): string {
  const e = normaliseEmail(email)
  return `${Buffer.from(e, 'utf8').toString('base64url')}.${keyedHash('news-unsubscribe', e).slice(0, 32)}`
}

export function readUnsubscribeToken(token: unknown): string | null {
  const [payload, sig] = (typeof token === 'string' ? token : '').split('.')
  if (!payload || !sig || !/^[0-9a-f]{32}$/.test(sig)) return null
  let email: string
  try { email = Buffer.from(payload, 'base64url').toString('utf8') } catch { return null }
  if (email !== normaliseEmail(email) || !email.includes('@')) return null
  return sameHex(keyedHash('news-unsubscribe', email).slice(0, 32), sig) ? email : null
}

/**
 * THE "YES, KEEP ME INFORMED" TOKEN names a SUBSCRIBER (Raptor's names a send: its consent lives on the lead the
 * send went to). Remus's yes is recorded on the subscriber, and a sign-up's confirmation has no send to name.
 */
export function optInToken(subscriberId: string): string {
  return `${Buffer.from(subscriberId, 'utf8').toString('base64url')}.${keyedHash('news-opt-in', subscriberId).slice(0, 32)}`
}

export function readOptInToken(token: unknown): string | null {
  const [payload, sig] = (typeof token === 'string' ? token : '').split('.')
  if (!payload || !sig || !/^[0-9a-f]{32}$/.test(sig)) return null
  let id: string
  try { id = Buffer.from(payload, 'base64url').toString('utf8') } catch { return null }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null
  return sameHex(keyedHash('news-opt-in', id).slice(0, 32), sig) ? id : null
}

/* ------------------------------------------------------------------------------------------------ Resend */

export interface OutgoingEmail { from: string; to: string[]; reply_to?: string; subject: string; html: string; text: string; headers: Record<string, string> }
type SendOutcome = { ok: true; ids: string[] } | { ok: false; status: number; message: string }

/** ONE CALL TO RESEND: a batch of up to a hundred, or one email. The idempotency key makes a retry safe (Raptor). */
async function resendSend(apiKey: string, emails: OutgoingEmail[], key: string): Promise<SendOutcome> {
  const single = emails.length === 1
  let res: Response
  try {
    res = await fetch(single ? 'https://api.resend.com/emails' : 'https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(single ? emails[0] : emails),
    })
  } catch (e) {
    return { ok: false, status: 0, message: e instanceof Error ? e.message : 'Resend could not be reached.' }
  }
  const body = await res.json().catch(() => ({})) as { data?: unknown; id?: string; message?: string; name?: string }
  if (!res.ok) return { ok: false, status: res.status, message: body.message ?? body.name ?? `Resend answered ${res.status}.` }
  const ids = single
    ? [body.id ?? (body.data as { id?: string } | undefined)?.id ?? '']
    : ((Array.isArray(body.data) ? body.data : []) as { id?: string }[]).map((d) => d?.id ?? '')
  if (ids.length !== emails.length) return { ok: false, status: 502, message: 'Resend answered with a different number of emails than were sent.' }
  return { ok: true, ids }
}

const idempotencyKey = (ids: string[]) => `remus-news-${crypto.createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 40)}`

/* ------------------------------------------------------------------------------------------------ the list */

interface CampaignRow {
  id: string; name: string; kind: CampaignKind; subject: string; preheader: string; body: string; images: unknown
  audience: unknown; status: string; created_by: string | null; queued_by: string | null
}
const CAMPAIGN_COLUMNS = 'id, name, kind, subject, preheader, body, images, audience, status, created_by, queued_by'

async function loadCampaign(admin: SupabaseClient, id: string): Promise<CampaignRow | null> {
  const { data } = await admin.from('marketing_campaigns').select(CAMPAIGN_COLUMNS).eq('id', id).maybeSingle()
  return data ? { ...(data as CampaignRow), kind: parseKind((data as CampaignRow).kind) } : null
}

/** Every row, in pages: a list that quietly stopped at PostgREST's thousand would miss people (Raptor). */
async function all<T>(q: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> }): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 200_000; from += 1000) {
    const { data, error } = await q().range(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/** THE PREVIEW AND THE SEND ARE ONE CALCULATION (Raptor): both call this, over every row. */
async function resolveOnServer(admin: SupabaseClient, audienceRaw: unknown, kindRaw: unknown): Promise<AudienceResult | { error: string }> {
  const audience = parseAudience(audienceRaw)
  if (!audience) return { error: 'This newsletter has no list chosen.' }
  const kind = parseKind(kindRaw)
  if (kind === 'invitation' && !INVITATION_AUDIENCES.includes(audience.kind)) {
    return { error: 'An invitation goes to people who are not clients yet: choose “People who signed up” or an imported list.' }
  }
  try {
    type R = Record<string, unknown>
    const [companies, contacts, subscribers, projects, prefs, invited] = await Promise.all([
      all<R>(() => admin.from('companies').select('id, name, email').order('id')),
      all<R>(() => admin.from('contacts').select('id, first_name, last_name, email, company_id').order('id')),
      all<R>(() => admin.from('marketing_subscribers').select('id, email, name, company, list_id, consent_at, consent_how, consent_note').order('id')),
      audience.kind === 'clients_with_jobs'
        ? all<R>(() => admin.from('projects').select('company_id, contact_id').order('id'))
        : Promise.resolve([] as R[]),
      all<R>(() => admin.from('marketing_preferences').select('email, status').neq('status', 'subscribed').order('email')),
      all<R>(() => admin.from('marketing_sends').select('subscriber_id').eq('first_approach', true).not('subscriber_id', 'is', null)
        .not('state', 'in', '(failed,skipped)').order('id')),
    ])
    const s = (v: unknown) => (typeof v === 'string' ? v : null)
    const withJobs = new Set<string>()
    for (const p of projects) { if (p.company_id) withJobs.add(String(p.company_id)); if (p.contact_id) withJobs.add(String(p.contact_id)) }
    return resolveAudience({
      audience, kind,
      companies: companies.map((c) => ({ id: String(c.id), name: String(c.name ?? ''), email: s(c.email) })),
      contacts: contacts.map((c) => ({ id: String(c.id), firstName: String(c.first_name ?? ''), lastName: s(c.last_name), email: s(c.email), companyId: s(c.company_id) })),
      subscribers: subscribers.map((x) => ({
        id: String(x.id), email: String(x.email), name: s(x.name), company: s(x.company), listId: s(x.list_id),
        consentAt: s(x.consent_at), consentHow: s(x.consent_how), consentNote: s(x.consent_note),
      })),
      clientsWithJobs: withJobs,
      preferences: new Map(prefs.map((p) => [String(p.email), p.status as 'unsubscribed' | 'undeliverable'])),
      invitedSubscribers: new Set(invited.map((i) => String(i.subscriber_id))),
    })
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The list could not be read.' }
  }
}

/** FROM A DRAFT TO A LIST OF SENDS, ONCE: claimed first (a double press queues nothing twice), then one insert. */
async function queueCampaign(admin: SupabaseClient, campaignId: string, callerId: string)
  : Promise<{ queued: number; excluded: AudienceResult['excluded'] } | { error: string; status: number }> {
  const campaign = await loadCampaign(admin, campaignId)
  if (!campaign) return { error: 'No such newsletter.', status: 404 }
  if (campaign.status !== 'draft') return { error: 'This newsletter has already been sent.', status: 409 }
  if (!campaign.subject.trim() || !campaign.body.trim()) return { error: 'Give it a subject and some words first.', status: 400 }
  const unknown = unknownMergeFields(`${campaign.subject} ${campaign.preheader} ${campaign.body}`)
  if (unknown.length) return { error: `Remus does not know ${unknown.map((u) => `{{${u}}}`).join(', ')}.`, status: 400 }

  const resolved = await resolveOnServer(admin, campaign.audience, campaign.kind)
  if ('error' in resolved) return { error: resolved.error, status: 400 }
  if (resolved.recipients.length === 0) return { error: 'Nobody on this list can be sent to.', status: 400 }

  const now = new Date().toISOString()
  const { data: claimed } = await admin.from('marketing_campaigns')
    .update({ status: 'sending', queued_at: now, queued_by: callerId, recipient_count: resolved.recipients.length, updated_at: now })
    .eq('id', campaignId).eq('status', 'draft').select('id')
  if (!claimed?.length) return { error: 'This newsletter has already been sent.', status: 409 }

  const rows = resolved.recipients.map((r) => ({
    campaign_id: campaignId, email: r.email, first_name: r.firstName, company_name: r.companyName,
    company_id: r.companyId ?? null, contact_id: r.contactId ?? null, subscriber_id: r.subscriberId ?? null,
    basis: r.basis, first_approach: r.firstApproach,
  }))
  const { error } = await admin.from('marketing_sends').insert(rows)
  if (error) {
    await admin.from('marketing_campaigns').update({ status: 'draft', queued_at: null, queued_by: null, recipient_count: null }).eq('id', campaignId)
    return { error: `The list could not be saved, so nothing was sent: ${error.message}`, status: 409 }
  }
  return { queued: rows.length, excluded: resolved.excluded }
}

/* ------------------------------------------------------------------------------------------------ the send */

interface SendRow {
  id: string; campaign_id: string; email: string; first_name: string | null; company_name: string | null
  company_id: string | null; contact_id: string | null; subscriber_id: string | null; first_approach: boolean; attempts: number
}
interface Result { id: string; state: 'sent' | 'failed' | 'skipped' | 'queued'; resend_id?: string | null; error?: string | null }

export interface DrainReport {
  sent: number; failed: number; skipped: number; remaining: number
  /** Why it stopped before the list was done, in plain words. */
  stoppedFor: string | null
  /** Resend refused the key or the domain: trying again in a minute will not help. */
  setupRefusal: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * SEND WHAT IS QUEUED, A CHUNK AT A TIME, UNTIL THE BUDGET IS SPENT (Raptor's drainMarketing, news only).
 * THE UNSUBSCRIBE AND THE CONSENT ARE READ AGAIN HERE, not only when the list was drawn.
 */
async function drain(admin: SupabaseClient, req: VercelRequest, campaignId: string, budgetMs: number): Promise<DrainReport> {
  const report: DrainReport = { sent: 0, failed: 0, skipped: 0, remaining: 0, stoppedFor: null, setupRefusal: false }
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? ''
  const sender = newsSender(process.env)
  const origin = originFor(req)
  const finish = async () => {
    const { count } = await admin.from('marketing_sends').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('state', ['queued', 'sending'])
    report.remaining = count ?? 0
    return report
  }
  if (!apiKey) { report.stoppedFor = 'Sending is not set up: RESEND_API_KEY is missing in Vercel.'; return finish() }
  if ('error' in sender) { report.stoppedFor = sender.error; return finish() }
  if (!origin) { report.stoppedFor = 'The site address is not known, so no unsubscribe link can be written.'; return finish() }
  const campaign = await loadCampaign(admin, campaignId)
  if (!campaign || campaign.status !== 'sending') return finish()
  const co = await company(admin)
  const replyTo = process.env.MARKETING_REPLY_TO?.trim() || co.email
  const domain = mailDomainOf(sender.from)

  const started = Date.now()
  let lastCall = 0
  while (Date.now() - started < budgetMs) {
    const { data, error } = await admin.rpc('marketing_claim_sends', { p_limit: RESEND_BATCH_MAX, p_campaign: campaignId })
    if (error) { report.stoppedFor = error.message; break }
    const claimed = (data ?? []) as SendRow[]
    if (!claimed.length) break

    const results: Result[] = []
    const { data: prefRows } = await admin.from('marketing_preferences').select('email, status')
      .in('email', claimed.map((r) => r.email)).neq('status', 'subscribed')
    const stopped = new Map(((prefRows ?? []) as { email: string; status: string }[]).map((p) => [p.email, p.status]))
    const subIds = [...new Set(claimed.map((r) => r.subscriber_id).filter((x): x is string => !!x))]
    const { data: subRows } = subIds.length
      ? await admin.from('marketing_subscribers').select('id, consent_at').in('id', subIds)
      : { data: [] }
    const subs = new Map(((subRows ?? []) as { id: string; consent_at: string | null }[]).map((x) => [x.id, { consentAt: x.consent_at }]))

    const toSend: { row: SendRow; email: OutgoingEmail }[] = []
    for (const row of claimed) {
      const pref = stopped.get(row.email)
      if (pref) { results.push({ id: row.id, state: 'skipped', error: pref === 'undeliverable' ? 'Undeliverable' : 'Unsubscribed before it was sent' }); continue }
      const block = sendBlockReason({ subscriberId: row.subscriber_id, firstApproach: row.first_approach }, row.subscriber_id ? subs.get(row.subscriber_id) : null)
      if (block) { results.push({ id: row.id, state: 'skipped', error: block }); continue }
      if (!isSendableEmail(row.email)) { results.push({ id: row.id, state: 'failed', error: 'The address does not look right.' }); continue }
      if (row.attempts > MAX_ATTEMPTS) { results.push({ id: row.id, state: 'failed', error: `Gave up after ${MAX_ATTEMPTS} attempts.` }); continue }
      toSend.push({ row, email: buildEmail(row) })
    }

    let stop: string | null = null
    if (toSend.length) {
      const wait = RESEND_MIN_GAP_MS - (Date.now() - lastCall)
      if (wait > 0) await sleep(wait)
      lastCall = Date.now()
      const outcome = await resendSend(apiKey, toSend.map((t) => t.email), idempotencyKey(toSend.map((t) => t.row.id)))
      if (outcome.ok) {
        toSend.forEach((t, i) => results.push({ id: t.row.id, state: 'sent', resend_id: outcome.ids[i] || null, error: null }))
      } else if ((outcome.status === 400 || outcome.status === 422) && toSend.length > 1) {
        /* ONE BAD ADDRESS FAILS A WHOLE BATCH at Resend: sent again one by one, only the wrong one reported (Raptor). */
        for (const t of toSend) {
          if (stop) { results.push({ id: t.row.id, state: 'queued', error: null }); continue }
          const w = RESEND_MIN_GAP_MS - (Date.now() - lastCall)
          if (w > 0) await sleep(w)
          lastCall = Date.now()
          const one = await resendSend(apiKey, [t.email], idempotencyKey([t.row.id]))
          if (one.ok) results.push({ id: t.row.id, state: 'sent', resend_id: one.ids[0] || null, error: null })
          else if (one.status === 400 || one.status === 422) results.push({ id: t.row.id, state: 'failed', error: one.message.slice(0, 500) })
          else {
            results.push({ id: t.row.id, state: 'queued', error: one.message.slice(0, 500) })
            stop = plainResendError(one.status, one.message, domain)
            report.setupRefusal = isSetupRefusal(one.status, one.message)
          }
        }
      } else if (outcome.status === 400 || outcome.status === 422) {
        results.push({ id: toSend[0].row.id, state: 'failed', error: outcome.message.slice(0, 500) })
      } else {
        /* Refused, rate-limited or unreachable: back in the queue untouched, and stop for now. */
        for (const t of toSend) results.push({ id: t.row.id, state: 'queued', error: outcome.message.slice(0, 500) })
        stop = plainResendError(outcome.status, outcome.message, domain)
        report.setupRefusal = isSetupRefusal(outcome.status, outcome.message)
      }
    }
    await admin.rpc('marketing_record_results', { p_results: results })
    for (const r of results) {
      if (r.state === 'sent') report.sent += 1
      else if (r.state === 'failed') report.failed += 1
      else if (r.state === 'skipped') report.skipped += 1
    }
    if (stop) { report.stoppedFor = stop; break }
  }
  return finish()

  function buildEmail(row: SendRow): OutgoingEmail {
    const token = unsubscribeToken(row.email)
    const invitation = campaign!.kind === 'invitation'
    const rendered = renderNewsEmail(
      { subject: campaign!.subject, preheader: campaign!.preheader, body: campaign!.body, images: cleanPictures(campaign!.images) },
      { firstName: row.first_name, companyName: row.company_name },
      {
        unsubscribeUrl: `${origin}/unsubscribe/${token}`, companyName: co.name, companyAddress: co.address, logoUrl: co.logoUrl,
        basis: invitation ? 'invitation' : row.subscriber_id ? 'subscriber' : 'client',
        optInUrl: invitation && row.subscriber_id ? `${origin}/opt-in/${optInToken(row.subscriber_id)}` : null,
      },
    )
    return {
      from: (sender as { from: string }).from,
      to: [row.email],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      /* RFC 8058 ONE-CLICK (Raptor): a mail program's own Unsubscribe button POSTs here, no page in between. */
      headers: {
        'List-Unsubscribe': `<${origin}/api/portal/news-unsubscribe?t=${token}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }
  }
}

/* ------------------------------------------------------------------------------------------------ Administrators */

async function requireAdministrator(req: VercelRequest, res: VercelResponse, admin: SupabaseClient) {
  const caller = await requireCaller(req)
  if (!caller) { res.status(401).json({ error: 'Please sign in again.' }); return null }
  const { data: p } = await admin.from('profiles').select('id, name, email, role, status').eq('id', caller.user.id).maybeSingle()
  if (!p || p.status !== 'Active' || p.role !== 'Administrator') {
    res.status(403).json({ error: 'Sending news is for Administrators.' }); return null
  }
  return { id: String(p.id), name: String(p.name ?? ''), email: String(p.email || caller.user.email || '') }
}

const body = (req: VercelRequest) => (typeof req.body === 'object' && req.body ? req.body : {}) as Record<string, unknown>

const config: Handler = async (req, res, admin) => {
  if (!(await requireAdministrator(req, res, admin))) return
  res.status(200).json({ ...(await senderConfig(admin)), keyProblem: credentialsKeyProblem() })
}

const preview: Handler = async (req, res, admin) => {
  if (!(await requireAdministrator(req, res, admin))) return
  const b = body(req)
  const resolved = await resolveOnServer(admin, b.audience, b.kind)
  if ('error' in resolved) { res.status(400).json({ error: resolved.error }); return }
  res.status(200).json({
    count: resolved.recipients.length,
    sample: resolved.recipients.slice(0, 12).map((r) => ({ email: r.email, firstName: r.firstName, companyName: r.companyName, via: r.via, basis: r.basis })),
    excluded: resolved.excluded,
  })
}

/** THE EMAIL AS IT WILL GO, drawn by the same function the send uses (Remus's api cannot share code with the page). */
const render: Handler = async (req, res, admin) => {
  if (!(await requireAdministrator(req, res, admin))) return
  const b = body(req)
  const c = (b.campaign ?? {}) as Record<string, unknown>
  const kind = parseKind(c.kind)
  const co = await company(admin)
  const origin = originFor(req) ?? ''
  const sample = (b.sample ?? {}) as { firstName?: string | null; companyName?: string | null }
  const out = renderNewsEmail(
    { subject: String(c.subject ?? ''), preheader: String(c.preheader ?? ''), body: String(c.body ?? ''), images: cleanPictures(c.images) },
    { firstName: sample.firstName ?? null, companyName: sample.companyName ?? null },
    {
      unsubscribeUrl: `${origin}/unsubscribe/preview`, companyName: co.name, companyAddress: co.address, logoUrl: co.logoUrl,
      basis: kind === 'invitation' ? 'invitation' : 'client', optInUrl: kind === 'invitation' ? `${origin}/opt-in/preview` : null,
    },
  )
  res.status(200).json({ ...out, unknown: unknownMergeFields(`${c.subject ?? ''} ${c.preheader ?? ''} ${c.body ?? ''}`) })
}

/** Everything below sends: not on a half-set-up sender. */
async function readyToSend(res: VercelResponse, admin: SupabaseClient): Promise<boolean> {
  const cfg = await senderConfig(admin)
  if (!cfg.ready) {
    res.status(412).json({ error: cfg.problem ?? `Sending is not set up yet: ${cfg.missing.join(' and ')} must be set in Vercel. Nothing was sent.`, missing: cfg.missing })
    return false
  }
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: keyProblem }); return false }
  return true
}

const test: Handler = async (req, res, admin) => {
  const me = await requireAdministrator(req, res, admin)
  if (!me || !(await readyToSend(res, admin))) return
  const campaign = await loadCampaign(admin, String(body(req).campaignId ?? ''))
  if (!campaign) { res.status(404).json({ error: 'No such newsletter.' }); return }
  const origin = originFor(req)
  if (!me.email || !origin) { res.status(400).json({ error: 'Your own address is not known, so there is nowhere to send a test.' }); return }
  const co = await company(admin)
  const sender = newsSender(process.env) as { from: string }
  const to = normaliseEmail(me.email)
  const rendered = renderNewsEmail(
    { subject: campaign.subject, preheader: campaign.preheader, body: campaign.body, images: cleanPictures(campaign.images) },
    { firstName: me.name.split(/\s+/)[0] || null, companyName: co.name },
    {
      unsubscribeUrl: `${origin}/unsubscribe/preview`, companyName: co.name, companyAddress: co.address, logoUrl: co.logoUrl,
      basis: campaign.kind === 'invitation' ? 'invitation' : 'client', optInUrl: campaign.kind === 'invitation' ? `${origin}/opt-in/preview` : null,
    },
  )
  const replyTo = process.env.MARKETING_REPLY_TO?.trim() || co.email
  /* A TEST IS NOT A SEND (Raptor): no row, and a fresh key each press so a test after an edit is not the first one. */
  const outcome = await resendSend(process.env.RESEND_API_KEY as string, [{
    from: sender.from, to: [to], ...(replyTo ? { reply_to: replyTo } : {}),
    subject: `[Test] ${rendered.subject}`, html: rendered.html, text: rendered.text, headers: {},
  }], idempotencyKey([campaign.id, String(Date.now())]))
  if (!outcome.ok) { res.status(502).json({ error: plainResendError(outcome.status, outcome.message, mailDomainOf(sender.from)) }); return }
  res.status(200).json({ sentTo: to })
}

const queue: Handler = async (req, res, admin) => {
  const me = await requireAdministrator(req, res, admin)
  if (!me || !(await readyToSend(res, admin))) return
  const campaignId = String(body(req).campaignId ?? '')
  const q = await queueCampaign(admin, campaignId, me.id)
  if ('error' in q) { res.status(q.status).json({ error: q.error }); return }
  const drained = await drain(admin, req, campaignId, 15_000)
  /*
   * THE DOMAIN IS NOT VERIFIED YET (7 Nov): Resend refuses the very first chunk. Nothing went, so the newsletter goes
   * back to a draft as it was -- not a "sending" one stuck for ever -- and the screen says why in plain words.
   */
  if (drained.setupRefusal && drained.sent === 0) {
    const { count } = await admin.from('marketing_sends').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).not('resend_id', 'is', null)
    if (!count) {
      await admin.from('marketing_sends').delete().eq('campaign_id', campaignId)
      await admin.from('marketing_campaigns').update({ status: 'draft', queued_at: null, queued_by: null, recipient_count: null })
        .eq('id', campaignId).eq('status', 'sending')
      res.status(412).json({ error: drained.stoppedFor, backToDraft: true }); return
    }
  }
  res.status(200).json({ queued: q.queued, excluded: q.excluded, ...drained })
}

const drainStep: Handler = async (req, res, admin) => {
  if (!(await requireAdministrator(req, res, admin)) || !(await readyToSend(res, admin))) return
  res.status(200).json(await drain(admin, req, String(body(req).campaignId ?? ''), 40_000))
}

const cancel: Handler = async (req, res, admin) => {
  if (!(await requireAdministrator(req, res, admin))) return
  const campaignId = String(body(req).campaignId ?? '')
  /* What has gone has gone; what has not is marked skipped and the newsletter says cancelled. */
  await admin.from('marketing_campaigns').update({ status: 'cancelled', finished_at: new Date().toISOString() })
    .eq('id', campaignId).eq('status', 'sending')
  await admin.from('marketing_sends').update({ state: 'skipped', error: 'Stopped before it was sent' })
    .eq('campaign_id', campaignId).eq('state', 'queued')
  res.status(200).json({ cancelled: true })
}

/* ---------- imported lists ---------- */

function rowsOf(b: Record<string, unknown>): { rows: ImportRow[] } | { error: string } {
  const csv = typeof b.csv === 'string' ? b.csv : ''
  if (!csv.trim()) return { error: 'Choose a .csv file first.' }
  if (csv.length > 3_000_000) return { error: 'That file is too big. Split it into smaller files.' }
  const sheet = readSubscriberSheet(readCsv(csv))
  if (sheet.problem) return { error: sheet.problem }
  return { rows: sheet.rows }
}

async function knownAddresses(admin: SupabaseClient) {
  type R = Record<string, unknown>
  const [companies, contacts, subs] = await Promise.all([
    all<R>(() => admin.from('companies').select('email').not('email', 'is', null).order('id')),
    all<R>(() => admin.from('contacts').select('email').not('email', 'is', null).order('id')),
    all<R>(() => admin.from('marketing_subscribers').select('email').order('id')),
  ])
  return {
    clients: new Set([...companies, ...contacts].map((r) => normaliseEmail(r.email)).filter(Boolean)),
    subscribers: new Set(subs.map((r) => normaliseEmail(r.email))),
  }
}

const importPreview: Handler = async (req, res, admin) => {
  if (!(await requireAdministrator(req, res, admin))) return
  const r = rowsOf(body(req))
  if ('error' in r) { res.status(400).json({ error: r.error }); return }
  const plan = planImport(r.rows, await knownAddresses(admin))
  res.status(200).json({ counts: plan.counts, examples: plan.examples, rows: r.rows.length })
}

/**
 * ADDING A LIST: one marketing_lists row and a subscriber per NEW address, from the same plan the preview showed.
 * "These people said yes" with WHERE they said it (consentNote) records consent for each, dated now, as the
 * Administrator's declaration; without it they can be sent ONE invitation and nothing else (POPIA s69(2)).
 */
const importList: Handler = async (req, res, admin) => {
  const me = await requireAdministrator(req, res, admin)
  if (!me) return
  const b = body(req)
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
  if (!name) { res.status(400).json({ error: 'Give the list a name.' }); return }
  const consentNote = typeof b.consentNote === 'string' ? b.consentNote.trim().slice(0, 500) : ''
  const r = rowsOf(b)
  if ('error' in r) { res.status(400).json({ error: r.error }); return }
  const plan = planImport(r.rows, await knownAddresses(admin))
  const fresh = plan.outcomes.filter((o) => o.outcome === 'new').map((o) => o.row)
  if (!fresh.length) { res.status(400).json({ error: 'Nobody new in that file.' }); return }
  const { data: list, error } = await admin.from('marketing_lists').insert({
    name, file_name: typeof b.fileName === 'string' ? b.fileName.slice(0, 200) : null, consent_note: consentNote || null,
    uploaded_by: me.id, counts: plan.counts, subscriber_count: fresh.length,
  }).select('id').single()
  if (error || !list) { res.status(500).json({ error: error?.message ?? 'The list could not be saved.' }); return }
  const now = new Date().toISOString()
  const rows = fresh.map((x) => ({
    email: x.email, name: x.name || null, company: x.company || null, phone: x.phone || null, source: 'imported list', list_id: list.id,
    created_by: me.id,
    ...(consentNote ? { consent_at: now, consent_how: 'imported with consent', consent_note: consentNote, consent_by: me.id } : {}),
  }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await admin.from('marketing_subscribers').upsert(rows.slice(i, i + 500), { onConflict: 'email', ignoreDuplicates: true })
    if (insErr) { res.status(500).json({ error: `Some of the list could not be saved: ${insErr.message}` }); return }
  }
  res.status(200).json({ id: list.id, written: rows.length, withConsent: !!consentNote })
}

/** A SITE DIARY PHOTO INTO A NEWSLETTER: only one ticked "show the client", copied to the public store. */
const diaryPhoto: Handler = async (req, res, admin) => {
  if (!(await requireAdministrator(req, res, admin))) return
  const id = String(body(req).photoId ?? '')
  const { data: photo } = await admin.from('site_diary_photos').select('id, path, caption, show_client').eq('id', id).maybeSingle()
  if (!photo) { res.status(404).json({ error: 'That photo could not be found.' }); return }
  if (!photo.show_client) { res.status(403).json({ error: 'Only photos ticked “show the client” go into news.' }); return }
  const { data: file, error } = await admin.storage.from('site-photos').download(String(photo.path))
  if (error || !file) { res.status(500).json({ error: 'The photo could not be read just now.' }); return }
  const type = file.type && /^image\/(jpeg|png|webp)$/.test(file.type) ? file.type : 'image/jpeg'
  const path = `diary/${photo.id}.${type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'}`
  const up = await admin.storage.from('news-pictures').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: true })
  if (up.error) { res.status(500).json({ error: `The photo could not be copied: ${up.error.message}` }); return }
  const { data: pub } = admin.storage.from('news-pictures').getPublicUrl(path)
  res.status(200).json({ url: pub.publicUrl, caption: (photo.caption as string | null) ?? null })
}

/* ------------------------------------------------------------------------------------------------ anybody */

/**
 * THE FIRST OBJECTION'S DATE IS KEPT (Raptor's unsubscribe): pressing the link twice must not move "unsubscribed on
 * 3 March" to today, and a hard bounce on file is a stronger state than an unsubscribe.
 */
async function recordUnsubscribe(admin: SupabaseClient, email: string, how: string, campaignId?: string | null, sendId?: string | null) {
  const { data } = await admin.from('marketing_preferences').select('status').eq('email', email).maybeSingle()
  const current = (data as { status?: string } | null)?.status
  if (current === 'unsubscribed') return
  if (current === 'undeliverable' && how !== 'complaint') return
  let target = sendId ?? null
  if (!target) {
    const { data: last } = await admin.from('marketing_sends').select('id, campaign_id')
      .eq('email', email).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1).maybeSingle()
    target = (last as { id?: string } | null)?.id ?? null
    campaignId = campaignId ?? (last as { campaign_id?: string } | null)?.campaign_id ?? null
  }
  await admin.from('marketing_preferences').upsert({ email, status: 'unsubscribed', how, reason: null, campaign_id: campaignId ?? null }, { onConflict: 'email' })
  if (target) await admin.from('marketing_sends').update({ unsubscribed_at: new Date().toISOString() }).eq('id', target).is('unsubscribed_at', null)
}

/**
 * THE UNSUBSCRIBE LINK (Raptor's api/_lib/email/unsubscribe.ts). Three doors, one rule:
 *   POST ?t=<token> "List-Unsubscribe=One-Click"   a mail program's own button: no page, no question.
 *   POST { token, step: status | unsubscribe | resubscribe }   the page at /unsubscribe/<token>.
 *   GET ?t=<token>   somebody pasted the address into a browser: sent to the page, never acted on.
 */
const unsubscribe: Handler = async (req, res, admin) => {
  const fromQuery = typeof req.query.t === 'string' ? req.query.t : ''
  if (req.method === 'GET') {
    res.setHeader('Location', fromQuery ? `/unsubscribe/${encodeURIComponent(fromQuery)}` : '/')
    res.status(303).end(); return
  }
  const b = body(req)
  const raw = typeof req.body === 'string' ? req.body : ''
  const oneClick = !!fromQuery && (raw.includes('List-Unsubscribe=One-Click') || b['List-Unsubscribe'] === 'One-Click')
  const email = readUnsubscribeToken(fromQuery || b.token)
  if (!email) { res.status(404).json({ error: 'This link is not one of ours, or it has been cut short.' }); return }
  const step = oneClick ? 'unsubscribe' : (typeof b.step === 'string' ? b.step : 'status')
  if (step === 'unsubscribe') await recordUnsubscribe(admin, email, oneClick ? 'one-click header' : 'unsubscribe link')
  else if (step === 'resubscribe') {
    await admin.from('marketing_preferences').upsert(
      { email, status: 'subscribed', how: 're-subscribed from the link', reason: 'Re-subscribed from the unsubscribe page' }, { onConflict: 'email' })
  } else if (step !== 'status') { res.status(400).json({ error: 'Unknown step.' }); return }
  const { data } = await admin.from('marketing_preferences').select('status, changed_at').eq('email', email).maybeSingle()
  res.status(200).json({ email: maskEmail(email), status: (data?.status as string) ?? 'subscribed', changedAt: (data?.changed_at as string) ?? null })
}

/**
 * "YES, KEEP ME INFORMED" (Raptor's api/_lib/email/optIn.ts): the invitation's button and the sign-up's
 * confirmation. A SECOND PRESS, NOT THE PAGE OPENING: a company mail system's link scanner opens every link, and a
 * yes recorded on opening could be a scanner's. The page asks 'status'; only the person's Confirm sends 'yes'.
 * "That wasn't me" undoes it and unsubscribes the address.
 */
const optIn: Handler = async (req, res, admin) => {
  const b = body(req)
  const id = readOptInToken(b.token)
  if (!id) { res.status(404).json({ error: 'This link is not one of ours, or it has been cut short.' }); return }
  const { data: sub } = await admin.from('marketing_subscribers').select('id, email, source, consent_at').eq('id', id).maybeSingle()
  if (!sub) { res.status(404).json({ error: 'This link is no longer valid.' }); return }
  const email = String(sub.email)
  const step = typeof b.step === 'string' ? b.step : 'status'
  const now = new Date().toISOString()
  if (step === 'yes') {
    const how = sub.source === 'sign-up page' ? 'sign-up page' : 'opt-in link'
    /* THE FIRST YES'S DATE IS KEPT: pressing twice does not move it. */
    if (!sub.consent_at) {
      await admin.from('marketing_subscribers').update({
        consent_at: now, consent_how: how, consent_by: null,
        consent_note: how === 'sign-up page' ? 'Signed up on the news page and confirmed from the email' : 'Pressed “Yes, keep me informed” in the invitation',
      }).eq('id', id)
    }
    await admin.from('marketing_preferences').upsert({ email, status: 'subscribed', how, reason: 'Confirmed from the email' }, { onConflict: 'email' })
    /* The invitation that asked, if there was one, is marked: the newsletter can say how many said yes. */
    const { data: inv } = await admin.from('marketing_sends').select('id').eq('subscriber_id', id).eq('first_approach', true)
      .is('opted_in_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (inv) await admin.from('marketing_sends').update({ opted_in_at: now }).eq('id', inv.id)
  } else if (step === 'withdraw') {
    await admin.from('marketing_subscribers').update({ consent_at: null, consent_how: null, consent_note: 'Withdrawn from the thank-you page', consent_by: null }).eq('id', id)
    await admin.from('marketing_sends').update({ opted_in_at: null }).eq('subscriber_id', id).not('opted_in_at', 'is', null)
    await recordUnsubscribe(admin, email, 'unsubscribe link')
  } else if (step !== 'status') { res.status(400).json({ error: 'Unknown step.' }); return }
  const { data: after } = await admin.from('marketing_subscribers').select('consent_at').eq('id', id).maybeSingle()
  const { data: pref } = await admin.from('marketing_preferences').select('status').eq('email', email).maybeSingle()
  res.status(200).json({ email: maskEmail(email), optedIn: !!after?.consent_at && pref?.status !== 'unsubscribed' })
}

/**
 * THE PUBLIC SIGN-UP PAGE (/subscribe, no login). Stephan asked for "sign-up"; Raptor has none (its strangers are
 * asked by an introduction email). DOUBLE OPT-IN, because a form anybody can type any address into is not that
 * person's consent: the sign-up is stored with no consent, and a confirmation email goes to the address; only the
 * press in it records the yes (news-opt-in). A box nobody can see (`website`) catches robots. The same answer
 * whatever the address, so the form cannot be used to find out who is on the list.
 */
const SIGN_UP_THANKS = 'Thank you. We have sent you an email: press the button in it to confirm, and you are on our list.'
const signUp: Handler = async (req, res, admin) => {
  const b = body(req)
  if (typeof b.website === 'string' && b.website.trim()) { res.status(200).json({ message: SIGN_UP_THANKS }); return }
  const email = normaliseEmail(b.email)
  if (!email || !isSendableEmail(email)) { res.status(400).json({ error: 'Type your email address.' }); return }
  if (b.agree !== true) { res.status(400).json({ error: 'Tick the box to say you want our news.' }); return }
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : ''
  const companyName = typeof b.company === 'string' ? b.company.trim().slice(0, 120) : ''
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) { res.status(500).json({ error: 'Sign-up is not available just now.' }); return }

  const { data: existing } = await admin.from('marketing_subscribers').select('id, consent_at, confirm_sent_at').eq('email', email).maybeSingle()
  if (existing?.consent_at) { res.status(200).json({ message: 'Thank you. You are already on our list.' }); return }
  /* One confirmation per address per ten minutes: the form cannot be used to flood somebody's inbox. */
  if (existing?.confirm_sent_at && Date.now() - Date.parse(String(existing.confirm_sent_at)) < 10 * 60_000) {
    res.status(200).json({ message: SIGN_UP_THANKS }); return
  }
  const row = existing
    ? await admin.from('marketing_subscribers').update({ ...(name ? { name } : {}), ...(companyName ? { company: companyName } : {}) }).eq('id', existing.id).select('id').single()
    : await admin.from('marketing_subscribers').insert({ email, name: name || null, company: companyName || null, source: 'sign-up page', created_by: null }).select('id').single()
  if (row.error || !row.data) { res.status(500).json({ error: 'Your sign-up could not be saved just now. Try again in a minute.' }); return }

  const sender = newsSender(process.env)
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const origin = originFor(req)
  if (!apiKey || 'error' in sender || !origin) {
    res.status(503).json({ error: 'Thank you. We cannot send the confirmation email just yet: our news is still being set up. Please try again in a few days.' }); return
  }
  const co = await company(admin)
  const mail = confirmEmail({
    name, companyName: co.name, logoUrl: co.logoUrl,
    confirmUrl: `${origin}/opt-in/${optInToken(String(row.data.id))}`, unsubscribeUrl: `${origin}/unsubscribe/${unsubscribeToken(email)}`,
  })
  const outcome = await resendSend(apiKey, [{
    from: sender.from, to: [email], ...(co.email ? { reply_to: co.email } : {}), subject: mail.subject, html: mail.html, text: mail.text, headers: {},
  }], idempotencyKey([String(row.data.id), String(Math.floor(Date.now() / 600_000))]))
  if (!outcome.ok) {
    console.error(`[news] sign-up confirmation for subscriber ${row.data.id} did not go: ${outcome.status} ${outcome.message}`)
    res.status(503).json({ error: 'Thank you. We could not send the confirmation email just now: our news is still being set up. Please try again in a few days.' }); return
  }
  await admin.from('marketing_subscribers').update({ confirm_sent_at: new Date().toISOString() }).eq('id', row.data.id)
  res.status(200).json({ message: SIGN_UP_THANKS })
}

/**
 * WHAT HAPPENED AFTER IT LEFT (Raptor's resendWebhook.ts). Resend's signature (Svix) is the authority; without
 * RESEND_WEBHOOK_SECRET nothing is accepted. Every event stamps its send (once, on the svix-id). A hard bounce marks
 * the address UNDELIVERABLE, never mailed again; "report spam" is an UNSUBSCRIBE (POPIA s69).
 */
const webhook: Handler = async (req, res, admin) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) { res.status(503).json({ error: 'RESEND_WEBHOOK_SECRET is not set, so no delivery report is accepted.' }); return }
  const raw = await rawBody(req)
  const header = (n: string) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v ?? '' }
  if (!verifySvix(secret, header('svix-id'), header('svix-timestamp'), header('svix-signature'), raw, Date.now())) {
    res.status(401).json({ error: 'Signature does not match.' }); return
  }
  let event: ResendEvent
  try { event = JSON.parse(raw) } catch { res.status(400).json({ error: 'Not JSON.' }); return }
  const delivery = deliveryEvent(event, header('svix-id'))
  if (!delivery) { res.status(200).json({ ignored: event.type ?? null }); return }
  const { data: recorded, error } = await admin.rpc('marketing_record_event', {
    p_event_id: delivery.eventId, p_resend_id: delivery.resendId, p_type: delivery.type,
    p_at: delivery.at, p_note: delivery.note, p_count_click: delivery.countClick,
  })
  /* A failure is a 500, so Resend tries again later rather than the event being lost. */
  if (error) { res.status(500).json({ error: error.message }); return }
  const r = (recorded ?? {}) as { status?: string; send_id?: string; campaign_id?: string; email?: string }
  if (r.status === 'duplicate') { res.status(200).json({ duplicate: true }); return }
  const outcome = bounceOutcome(event)
  if (outcome) {
    const to = Array.isArray(event.data?.to) ? event.data?.to[0] : event.data?.to
    const email = r.email ?? normaliseEmail(to)
    if (email && outcome.preference === 'undeliverable') {
      await admin.from('marketing_preferences').upsert(
        { email, status: 'undeliverable', how: 'hard bounce', reason: outcome.note, campaign_id: r.campaign_id ?? null }, { onConflict: 'email' })
    } else if (email && outcome.preference === 'unsubscribed') {
      await recordUnsubscribe(admin, email, 'complaint', r.campaign_id ?? null, r.send_id ?? null)
    }
  }
  res.status(200).json({ ok: true, status: r.status ?? null })
}

/** THE BYTES RESEND SIGNED: the stream if still unread, else the parsed body written back out (Raptor). */
async function rawBody(req: VercelRequest): Promise<string> {
  if (req.readable && !req.readableEnded) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    if (chunks.length) return Buffer.concat(chunks).toString('utf8')
  }
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  return req.body === undefined ? '' : JSON.stringify(req.body)
}

/* ------------------------------------------------------------------------------------------------ the door */

const NEWS_ROUTES: Record<string, Handler> = {
  'news-config': config,
  'news-preview': preview,
  'news-render': render,
  'news-test': test,
  'news-queue': queue,
  'news-drain': drainStep,
  'news-cancel': cancel,
  'news-import-preview': importPreview,
  'news-import': importList,
  'news-diary-photo': diaryPhoto,
  'news-unsubscribe': unsubscribe,
  'news-opt-in': optIn,
  'news-sign-up': signUp,
  'news-resend-webhook': webhook,
}

/** Called by api/_lib/portal.ts for every /api/portal/news-* action. */
export async function newsHandler(req: VercelRequest, res: VercelResponse, action: string): Promise<void> {
  const route = Object.prototype.hasOwnProperty.call(NEWS_ROUTES, action) ? NEWS_ROUTES[action] : undefined
  if (!route) { res.status(404).json({ error: `Unknown news route: ${action}` }); return }
  if (req.method !== 'POST' && !(action === 'news-unsubscribe' && req.method === 'GET')) { res.status(405).json({ error: 'Method not allowed' }); return }
  const admin = adminClient()
  if (!admin) { res.status(501).json({ error: 'News is not set up yet: add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.' }); return }
  /* The tokens are keyed with the server's key: without it there is no unsubscribe link to write or read. */
  if (action !== 'news-resend-webhook' && action !== 'news-config') {
    const keyProblem = credentialsKeyProblem()
    if (keyProblem) { res.status(500).json({ error: keyProblem }); return }
  }
  try {
    await route(req, res, admin)
  } catch (e) {
    console.error(`[news] ${action} failed`, e)
    if (!res.headersSent) res.status(500).json({ error: e instanceof Error ? e.message : 'Something went wrong.' })
  }
}
