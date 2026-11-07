import type { VercelRequest, VercelResponse } from '@vercel/node'
import nodemailer from 'nodemailer'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Caller } from './auth.js'
import { credentialsKeyProblem } from './crypto.js'
import { adminClient, getConnection, logEmailActivity, sendFromOwnMailbox, type MailboxConnection } from './mailbox.js'
import { buildStatementPdf, loadStatement, longDate, periodWords, StatementPdfError, statementSummary, zar, type StatementClientKind } from './statementPdf.js'

/**
 * THE STATEMENT, BY EMAIL AND AS A FILE (Remus · Handover 8). Stephan, 7 Nov: "Definitely a statement of account."
 *
 * Rides on the two quote endpoints rather than a new function (Vercel counts them):
 *   GET  /api/quotes/pdf?statement=company|contact&client=<id>&from=yyyy-mm-dd&to=yyyy-mm-dd  -> the PDF
 *   POST /api/quotes/send { statement: { kind, id, from, to }, to, cc, subject, message }       -> emails it
 *
 * Sent THE SAME WAY A QUOTE IS (api/quotes/send.ts): from the person's own mailbox when they have connected one in
 * Settings -> My email (their signature, a copy in their Sent folder), else from the company sender (Resend or
 * SMTP). The email is filed on the client's Emails tab like every other.
 *
 * MONEY, SO ADMINISTRATORS ONLY (lib/access.ts seesMoney): a Read-only person may download it; only an
 * Administrator may send it. Row-level security refuses the invoices to anyone else regardless.
 */

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

interface Me {
  name: string | null; role: string; status: string; email_signature: string | null
  email_signature_image_url: string | null; email_signature_image_width: number | null; email_signature_image_align: string | null
}

async function whoIs(db: SupabaseClient, userId: string): Promise<Me | null> {
  const { data } = await db
    .from('profiles')
    .select('name, role, status, email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align')
    .eq('id', userId)
    .maybeSingle()
  return (data as Me | null) ?? null
}

/** lib/access.ts seesMoney, on the server: Administrators and Read-only. */
export function profileSeesMoney(me: Pick<Me, 'role' | 'status'> | null): boolean {
  return !!me && me.status === 'Active' && (me.role === 'Administrator' || me.role === 'Read Only')
}

export interface StatementAsk { kind: StatementClientKind; id: string; from: string | null; to: string | null }

export function readStatementAsk(raw: unknown): StatementAsk | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const kind = r.kind === 'company' || r.kind === 'contact' ? r.kind : null
  const id = typeof r.id === 'string' && r.id ? r.id : null
  if (!kind || !id) return null
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  return { kind, id, from: day(r.from), to: day(r.to) }
}

/** GET: the statement PDF. */
export async function statementPdfHandler(req: VercelRequest, res: VercelResponse, caller: Caller) {
  const ask = readStatementAsk({ kind: req.query.statement, id: req.query.client, from: req.query.from, to: req.query.to })
  if (!ask) return res.status(400).json({ error: 'statement (company or contact) and client are required.' })
  if (!profileSeesMoney(await whoIs(caller.db, caller.user.id))) return res.status(403).json({ error: 'Statements are for the people who see the money.' })
  try {
    const pdf = await buildStatementPdf(await loadStatement(caller.db, ask))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${pdf.filename}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).send(Buffer.from(pdf.bytes))
  } catch (e) {
    if (e instanceof StatementPdfError) return res.status(404).json({ error: e.message })
    console.error('Statement PDF failed', e)
    return res.status(500).json({ error: 'Could not build the statement.' })
  }
}

type Mailer = 'resend' | 'smtp' | null
/** The company-wide sender (api/quotes/send.ts mailer), used when the person hasn't connected their own mailbox. */
function mailer(): Mailer {
  const env = process.env
  if (env.RESEND_API_KEY && (env.EMAIL_FROM || env.SMTP_FROM)) return 'resend'
  if (env.SMTP_HOST && (env.SMTP_FROM || env.EMAIL_FROM)) return 'smtp'
  return null
}
async function ownMailbox(userId: string): Promise<MailboxConnection | null> {
  const admin = adminClient()
  if (!admin || credentialsKeyProblem()) return null
  return getConnection(admin, userId)
}

/** POST: email the statement to the client. */
export async function statementSendHandler(req: VercelRequest, res: VercelResponse, caller: Caller) {
  const body = (req.body ?? {}) as { statement?: unknown; to?: unknown; cc?: unknown; subject?: unknown; message?: unknown }
  const ask = readStatementAsk(body.statement)
  const to = Array.isArray(body.to) ? body.to.filter((x): x is string => typeof x === 'string') : []
  const cc = Array.isArray(body.cc) ? body.cc.filter((x): x is string => typeof x === 'string') : []
  if (!ask || to.length === 0) return res.status(400).json({ error: 'The client and at least one recipient are required.' })
  const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e))
  if (bad) return res.status(400).json({ error: `"${bad}" is not a valid email address.` })
  if (to.length + cc.length > 10) return res.status(400).json({ error: 'Too many recipients.' })

  const { db } = caller
  const me = await whoIs(db, caller.user.id)
  if (!me || me.status !== 'Active' || me.role !== 'Administrator') {
    return res.status(403).json({ error: 'Only an Administrator can send a statement.' })
  }
  const own = await ownMailbox(caller.user.id)
  const via = own ? null : mailer()
  if (!own && !via) {
    return res.status(503).json({ configured: false, error: "Email sending isn't set up yet. Connect your mailbox in Settings → My email, or download the statement and email it yourself for now." })
  }

  let data, pdf
  try {
    data = await loadStatement(db, ask)
    pdf = await buildStatementPdf(data)
  } catch (e) {
    if (e instanceof StatementPdfError) return res.status(404).json({ error: e.message })
    console.error('Statement PDF failed', e)
    return res.status(500).json({ error: 'Could not build the statement, so the email was not sent.' })
  }
  const st = data.statement
  const { owing, overdue } = statementSummary(st)
  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim().slice(0, 200) : `Statement of account: ${data.client.name}`
  const message = typeof body.message === 'string' ? body.message.slice(0, 5000) : ''

  const summary = `
<table style="border-collapse:collapse;margin-top:16px;font-size:14px;min-width:320px">
  <tr><td colspan="2" style="padding:6px 0;font-weight:600;border-bottom:2px solid #ef6723">Statement of account · ${esc(data.client.name)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Period</td><td style="text-align:right">${esc(periodWords(st))}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Invoiced</td><td style="text-align:right">${zar(st.invoiced)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">Received</td><td style="text-align:right">${zar(st.received)}</td></tr>
  ${overdue > 0 ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Of which overdue</td><td style="text-align:right">${zar(overdue)}</td></tr>` : ''}
  <tr><td style="padding:6px 12px 6px 0;font-weight:700;border-top:1px solid #e2e8f0">${st.inCredit > 0 && owing === 0 ? 'In credit' : 'Amount due'}</td><td style="text-align:right;font-weight:700;border-top:1px solid #e2e8f0">${zar(st.inCredit > 0 && owing === 0 ? st.inCredit : owing)}</td></tr>
  <tr><td colspan="2" style="padding-top:8px;color:#64748b;font-size:12px">As at ${esc(longDate(st.asAt))}</td></tr>
</table>`
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">${esc(message).replace(/\n/g, '<br>')}${summary}</div>`
  const text = `${message}\n\nStatement of account: ${data.client.name}\nPeriod: ${periodWords(st)}\nAmount due: ${zar(owing)}`
  const files = [{ filename: pdf.filename, content: Buffer.from(pdf.bytes), contentType: 'application/pdf' }]

  const { data: company } = await db.from('company_settings').select('email').eq('id', true).maybeSingle()
  const replyTo = (company as { email?: string | null } | null)?.email ?? undefined
  const FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || ''
  let messageId: string | null = null
  try {
    if (own) {
      messageId = await sendFromOwnMailbox(own, me as Parameters<typeof sendFromOwnMailbox>[1], { to, cc, subject, html, text, attachments: files })
    } else if (via === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to, cc: cc.length ? cc : undefined, reply_to: replyTo, subject, html, text,
          attachments: files.map((f) => ({ filename: f.filename, content: f.content.toString('base64'), content_type: f.contentType })),
        }),
      })
      if (!r.ok) {
        const detail = (await r.json().catch(() => null)) as { message?: string } | null
        throw new Error(detail?.message ?? `Resend answered HTTP ${r.status}`)
      }
    } else {
      const port = Number(process.env.SMTP_PORT || 465)
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port, secure: port === 465,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
      })
      await transporter.sendMail({ from: FROM, to, cc: cc.length ? cc : undefined, replyTo, subject, html, text, attachments: files })
    }
  } catch (e) {
    console.error('Statement email failed', e)
    return res.status(502).json({ error: `The email could not be sent: ${e instanceof Error ? e.message : String(e)}` })
  }

  // On the client's Emails tab, so a reply files onto the same client when the mailbox syncs.
  await logEmailActivity(db, {
    userId: caller.user.id,
    companyId: ask.kind === 'company' ? ask.id : null,
    contactId: ask.kind === 'contact' ? ask.id : null,
    subject,
    notes: `${message}\n\nAttached: ${pdf.filename}`.trim(),
    messageId,
  })
  return res.status(200).json({ ok: true, attached: [pdf.filename] })
}
