import { createHash } from 'node:crypto'
import nodemailer from 'nodemailer'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * STORE A CRASH AND, THE FIRST TIME WE SEE IT, TELL THE ADMINISTRATORS (Remus · Handover 8, 7 Nov 2026). Copied from
 * Raptor 55a7520's api/_lib/errorAlert.ts and api/report-error.ts ("get told when it breaks"). Stephan, 7 Nov, on what
 * Raptor has that Remus does not: "We can like start with pretty much all of that."
 *
 * The browser (src/lib/errorReporter.ts) posts a crash to /api/portal/report-error; it lands here.
 *
 * DIFFERENT FROM RAPTOR, AND WHY:
 *   - NO NEW FUNCTION. Vercel counts functions and Remus is near its limit, so the report is one more action on the
 *     existing /api/portal/[action] endpoint (it is already open to signed-out callers -- the sign-in page can crash
 *     too -- and already runs with the service role) instead of Raptor's own /api/report-error.
 *   - THE COMPANY SENDER, NOT A KEY OF ITS OWN. Raptor gave alerts a separate Resend key because its main key belongs
 *     to another product. Remus has one sender for the firm (RESEND_API_KEY + EMAIL_FROM, else SMTP -- the same as
 *     api/quotes/send.ts), so alerts use it.
 *   - TO THE ACTIVE ADMINISTRATORS, read from profiles, instead of a list typed into an environment variable: a new
 *     Administrator is told without anybody remembering to add them. And each gets a bell notification too.
 *   - AT MOST THREE ALERTS AN HOUR across every error, on top of Raptor's one alert per distinct error per six hours:
 *     a bad deploy that breaks ten pages is three emails, and every occurrence is still counted in error_reports.
 *
 * Open to signed-out callers on purpose. That is safe because all it can do is add or count a row in error_reports,
 * every field is length-capped, and alerts are deduplicated and capped, so it cannot be used to spam anyone.
 */
export const QUIET_HOURS = 6
export const ALERTS_PER_HOUR = 3

export interface ErrorReport {
  message: string
  stack?: string
  componentStack?: string
  source: string
  url?: string
  userAgent?: string
  build?: string
  userId?: string | null
  userEmail?: string | null
}

/*
 * Same bug, same fingerprint -- even when the message carries an id or an amount. Numbers and uuids are stripped from
 * the message, and only the top frame of the stack (minus the build hash and line:col, which move on every deploy) is
 * kept. (Raptor's, unchanged.)
 */
export function fingerprint(r: Pick<ErrorReport, 'message' | 'stack' | 'source'>): string {
  const msg = r.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>').replace(/\d+/g, '<n>')
  const frame = (r.stack ?? '').split('\n').find((l) => /^\s+at\s/.test(l) || l.includes('@')) ?? ''
  const where = frame.replace(/-[A-Za-z0-9_]{8}\.js/g, '.js').replace(/:\d+:\d+/g, '').trim()
  return createHash('sha256').update(`${r.source}|${msg}|${where}`).digest('hex').slice(0, 16)
}

/** Whether a sighting is told about: a new error (not seen in QUIET_HOURS), and fewer than ALERTS_PER_HOUR this hour. */
export function shouldAlert(seenRecently: boolean, alertsThisHour: number): boolean {
  return !seenRecently && alertsThisHour < ALERTS_PER_HOUR
}

const cap = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : undefined)

/** What the browser sent, checked and capped; null when there is no message. */
export function readReport(body: unknown, userAgentHeader?: string): ErrorReport | null {
  const b = (typeof body === 'string' ? safeJson(body) : body) as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return null
  const message = cap(b.message, 1000)
  if (!message) return null
  const source = typeof b.source === 'string' && ['render', 'window', 'promise', 'manual'].includes(b.source) ? b.source : 'window'
  return {
    message,
    stack: cap(b.stack, 6000),
    componentStack: cap(b.componentStack, 4000),
    source,
    url: cap(b.url, 500),
    userAgent: cap(b.userAgent ?? userAgentHeader, 300),
    build: cap(b.build, 100),
  }
}

function safeJson(s: string) {
  try { return JSON.parse(s) as unknown } catch { return null }
}

export async function recordError(admin: SupabaseClient, r: ErrorReport): Promise<{ alerted: boolean }> {
  const fp = fingerprint(r)
  const now = Date.now()
  const since = new Date(now - QUIET_HOURS * 3_600_000).toISOString()
  const { data: recent } = await admin.from('error_reports')
    .select('id, occurrences').eq('fingerprint', fp).gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false }).limit(1).maybeSingle()

  // Always in the Vercel function log too, which is where a missing table or sender gets noticed.
  console.error(`[remus-error ${fp}] ${r.source}: ${r.message}${r.url ? ` @ ${r.url}` : ''}`)

  if (recent) {
    await admin.from('error_reports')
      .update({ occurrences: Number(recent.occurrences ?? 1) + 1, last_seen_at: new Date(now).toISOString(), last_url: r.url ?? null })
      .eq('id', recent.id)
    return { alerted: false }
  }

  const { count } = await admin.from('error_reports').select('id', { count: 'exact', head: true })
    .gte('alerted_at', new Date(now - 3_600_000).toISOString())
  const alert = shouldAlert(false, count ?? 0)
  const { data: row, error } = await admin.from('error_reports').insert({
    fingerprint: fp,
    message: r.message,
    stack: r.stack ?? null,
    component_stack: r.componentStack ?? null,
    source: r.source,
    first_url: r.url ?? null,
    last_url: r.url ?? null,
    user_agent: r.userAgent ?? null,
    build: r.build ?? null,
    user_id: r.userId ?? null,
    user_email: r.userEmail ?? null,
    alerted_at: alert ? new Date(now).toISOString() : null,
  }).select('id').maybeSingle()
  // No table yet (0049 not applied): say so in the log and tell nobody -- without the table there is no cap either.
  if (error || !row) { console.error('error_reports insert failed:', error?.message); return { alerted: false } }
  if (!alert) return { alerted: false }

  const { data: admins } = await admin.from('profiles').select('id, email')
    .eq('role', 'Administrator').eq('status', 'Active')
  const people = (admins ?? []) as { id: string; email: string | null }[]
  if (!people.length) return { alerted: false }

  // The bell: one line each, opening the page that broke (app-relative, as every notification's link is).
  const path = pathOf(r.url)
  await admin.from('notifications').insert(people.map((p) => ({
    user_id: p.id, type: 'error_report',
    message: `Remus hit an error${r.userEmail ? ` for ${r.userEmail}` : ''}${path ? ` on ${path}` : ''}: ${r.message.slice(0, 140)}`,
    link: path,
  })))

  const to = people.map((p) => p.email).filter((e): e is string => !!e)
  if (to.length) await sendAlert(r, fp, to)
  return { alerted: true }
}

/** The page's path and query from a full address, for the bell's link; null when it is not one of ours to open. */
export function pathOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return (u.pathname + u.search).slice(0, 300) || '/'
  } catch { return null }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

async function sendAlert(r: ErrorReport, fp: string, to: string[]): Promise<boolean> {
  const { RESEND_API_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || ''
  if (!from || (!RESEND_API_KEY && !SMTP_HOST)) return false
  const who = r.userEmail ?? 'not signed in'
  const subject = `[Remus bug] ${r.message.slice(0, 90)}`
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">
    <h2 style="margin:0 0 8px">Remus hit an error</h2>
    <p style="margin:0 0 12px;font-size:15px"><b>${esc(r.message)}</b></p>
    <table style="font-size:13px;border-collapse:collapse">
      <tr><td style="padding:2px 12px 2px 0;color:#666">Where</td><td>${esc(r.url ?? '-')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Who</td><td>${esc(who)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Kind</td><td>${esc(r.source)}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Browser</td><td>${esc(r.userAgent ?? '-')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Build</td><td>${esc(r.build ?? '-')}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#666">Fingerprint</td><td>${fp}</td></tr>
    </table>
    ${r.stack ? `<pre style="font-size:11px;background:#f5f5f5;padding:8px;white-space:pre-wrap">${esc(r.stack.slice(0, 3000))}</pre>` : ''}
    <p style="font-size:12px;color:#666">You will not be emailed about this same error again for ${QUIET_HOURS} hours, and Remus sends
    at most ${ALERTS_PER_HOUR} of these an hour. Every occurrence is counted in the <code>error_reports</code> table.</p></div>`
  const text = `Remus hit an error: ${r.message}\nWhere: ${r.url ?? '-'}\nWho: ${who}\nKind: ${r.source}\nFingerprint: ${fp}\n\n${(r.stack ?? '').slice(0, 3000)}`
  try {
    if (RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, html, text }),
      })
      if (!res.ok) console.error('error alert email failed:', res.status, await res.text())
      return res.ok
    }
    const port = Number(SMTP_PORT || 465)
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port, secure: port === 465, auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS ?? '' } : undefined,
    })
    await transporter.sendMail({ from, to, subject, html, text })
    return true
  } catch (e) {
    console.error('error alert email failed:', e)
    return false
  }
}

/**
 * POST /api/portal/report-error -- what the browser sends (errorReporter.ts). Who saw it comes from their Remus
 * sign-in, when there is one; a portal client or the sign-in page reports with nobody named.
 */
export async function reportErrorRoute(req: VercelRequest, res: VercelResponse, admin: SupabaseClient): Promise<void> {
  const report = readReport(req.body, typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined)
  if (!report) { res.status(400).json({ error: 'message is required' }); return }
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) {
    const { data } = await admin.auth.getUser(auth.slice(7)).catch(() => ({ data: { user: null } }))
    report.userId = data.user?.id ?? null
    report.userEmail = data.user?.email ?? null
  }
  const { alerted } = await recordError(admin, report)
  res.status(200).json({ ok: true, alerted })
}
