import type { VercelRequest, VercelResponse } from '@vercel/node'
import nodemailer from 'nodemailer'
import { requireCaller, supabaseEnv } from '../_lib/auth.js'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { adminClient, getConnection, logEmailActivity, sendFromOwnMailbox, type MailboxConnection } from '../_lib/mailbox.js'
import { buildQuotePdf } from '../_lib/quotePdf.js'

/**
 * Emails a quote to the client.
 *
 * From the sender's own mailbox when they have connected one in Settings → My email (as in
 * Raptor's api/email/send.ts: SMTP with their signature, and a copy filed in their Sent folder).
 * Otherwise from the company sender: Resend's API (RESEND_API_KEY + EMAIL_FROM) or SMTP
 * (SMTP_HOST/PORT/USER/PASS/FROM). Resend wins when both are set.
 *
 * GET ?check=1 → { configured, from } so the app can say up front whether, and from where,
 * sending will work. With the caller's session it checks their own mailbox too.
 *
 * POST { quoteId, to: string[], cc?: string[], subject, message }
 *
 * Attachments: the quote's "client version" PDF if one was uploaded; otherwise the uploads marked
 * show_on_quote (internal documents/photos never go out) plus a PDF of the quote built on the server
 * (api/_lib/quotePdf.ts), with a quote summary in the email body.
 *
 * On success: quotes.sent_at / sent_to are stamped and a draft quote becomes 'sent'.
 */

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Copy of round2 in src/lib/format.ts (api/ can't import from src): cents, half away from zero,
 * like Postgres round(x, 2) in the quote_totals view.
 */
function round2(n: number): number {
  if (!Number.isFinite(n)) return n
  const cents = Math.round(Number((Math.abs(n) * 100).toPrecision(15)))
  return (Math.sign(n) * cents) / 100 || 0
}

function zar(n: number): string {
  const [int, frac] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}R ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac}`
}

type Mailer = 'resend' | 'smtp' | null

/** The company-wide sender, used when the person hasn't connected their own mailbox. */
function mailer(): Mailer {
  const env = process.env
  if (env.RESEND_API_KEY && (env.EMAIL_FROM || env.SMTP_FROM)) return 'resend'
  if (env.SMTP_HOST && (env.SMTP_FROM || env.EMAIL_FROM)) return 'smtp'
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET' && req.query.check) {
    const caller = await requireCaller(req)
    const own = caller ? await ownMailbox(caller.user.id) : null
    if (own) {
      res.status(200).json({ configured: true, from: own.email, own: true })
      return
    }
    const via = mailer()
    res.status(200).json({ configured: via !== null, from: via ? process.env.EMAIL_FROM || process.env.SMTP_FROM : null, own: false })
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseEnv()) {
    res.status(500).json({ error: 'Server is missing Supabase configuration.' })
    return
  }
  const caller = await requireCaller(req)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const own = await ownMailbox(caller.user.id)
  const via = own ? null : mailer()
  if (!own && !via) {
    res.status(503).json({ configured: false, error: "Email sending isn't set up yet. Connect your mailbox in Settings → My email, or download the PDF and email it yourself for now." })
    return
  }
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, RESEND_API_KEY } = process.env
  const FROM = process.env.EMAIL_FROM || process.env.SMTP_FROM || ''

  const body = (req.body ?? {}) as { quoteId?: unknown; to?: unknown; cc?: unknown; subject?: unknown; message?: unknown }
  const to = Array.isArray(body.to) ? body.to.filter((x): x is string => typeof x === 'string') : []
  const cc = Array.isArray(body.cc) ? body.cc.filter((x): x is string => typeof x === 'string') : []
  if (typeof body.quoteId !== 'string' || to.length === 0) {
    res.status(400).json({ error: 'quoteId and at least one recipient are required.' })
    return
  }
  const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e))
  if (bad) {
    res.status(400).json({ error: `"${bad}" is not a valid email address.` })
    return
  }
  if (to.length + cc.length > 10) {
    res.status(400).json({ error: 'Too many recipients.' })
    return
  }
  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim().slice(0, 200) : 'Quotation'
  const message = typeof body.message === 'string' ? body.message.slice(0, 5000) : ''

  const { db } = caller
  const { data: me } = await db
    .from('profiles')
    .select('name, role, status, email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align')
    .eq('id', caller.user.id)
    .maybeSingle()
  if (!me || me.status !== 'Active' || me.role === 'Read Only') {
    res.status(403).json({ error: 'Your access is read-only, so you can\'t send quotes.' })
    return
  }
  const [quoteRes, itemsRes, settingsRes, attRes] = await Promise.all([
    db.from('quotes').select('*').eq('id', body.quoteId).maybeSingle(),
    db.from('quote_items').select('section, description, quantity, unit, unit_price').eq('quote_id', body.quoteId).order('sort_order'),
    db.from('company_settings').select('name, email, phone').eq('id', true).maybeSingle(),
    db.from('quote_attachments').select('*').eq('quote_id', body.quoteId).order('sort_order'),
  ])
  const quote = quoteRes.data as
    | { id: string; number: string | null; title: string; site_address: string | null; status: string; valid_until: string | null; discount: number; vat_rate: number; company_id: string | null; contact_id: string | null }
    | null
  if (!quote) {
    res.status(404).json({ error: 'Quote not found.' })
    return
  }
  const items = (itemsRes.data ?? []) as { section: string | null; description: string; quantity: number; unit: string; unit_price: number }[]
  const settings = (settingsRes.data ?? {}) as { name?: string; email?: string | null; phone?: string | null }
  const attachments = (attRes.data ?? []) as { file_path: string; file_name: string; mime_type: string | null; kind: string; show_on_quote: boolean }[]

  // Totals (same arithmetic as src/lib/quoteMath.ts and the quote_totals view).
  const rawExcl = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0) - Number(quote.discount || 0)
  const rate = Number(quote.vat_rate || 0)
  const totalExcl = round2(rawExcl)
  const vat = round2((rawExcl * rate) / 100)
  const totalIncl = round2(rawExcl * (1 + rate / 100))

  // Keep in step with src/pages/build/quotes/SendQuoteModal.tsx.
  const clientPdf = attachments.find((a) => a.kind === 'client_pdf')
  const toAttach = clientPdf ? [clientPdf] : attachments.filter((a) => a.kind !== 'client_pdf' && a.show_on_quote)

  const files: { filename: string; content: Buffer; contentType?: string }[] = []
  let totalBytes = 0
  if (!clientPdf) {
    try {
      const pdf = await buildQuotePdf(db, quote.id)
      const content = Buffer.from(pdf.bytes)
      totalBytes += content.length
      files.push({ filename: pdf.filename, content, contentType: 'application/pdf' })
    } catch (e) {
      console.error('Quote PDF failed', e)
      res.status(500).json({ error: 'Could not build the quote PDF, so the email was not sent. Try again, or upload a client PDF.' })
      return
    }
  }
  for (const a of toAttach) {
    const dl = await db.storage.from('quote-files').download(a.file_path)
    if (dl.error || !dl.data) {
      // Never send the email without a file the person expects to go out (above all the client PDF).
      console.error('Quote attachment download failed', a.file_path, dl.error)
      res.status(502).json({ error: `Could not load "${a.file_name}" from storage, so the email was not sent. Try again, or remove the file.` })
      return
    }
    const content = Buffer.from(await dl.data.arrayBuffer())
    totalBytes += content.length
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      res.status(413).json({ error: 'Attachments are larger than 20 MB in total. Remove some files or upload a smaller client PDF.' })
      return
    }
    files.push({ filename: a.file_name, content, contentType: a.mime_type ?? undefined })
  }

  // Body: the person's message, plus a summary when no polished client PDF is attached.
  const sections = new Map<string, number>()
  for (const i of items) {
    if (!i.description.trim() && !Number(i.unit_price)) continue // empty placeholder line
    sections.set(i.section || 'General', (sections.get(i.section || 'General') ?? 0) + Number(i.quantity) * Number(i.unit_price))
  }
  const summary = clientPdf
    ? ''
    : `
<table style="border-collapse:collapse;margin-top:16px;font-size:14px;min-width:320px">
  <tr><td colspan="2" style="padding:6px 0;font-weight:600;border-bottom:2px solid #ef6723">Quote ${esc(quote.number ?? '')} · ${esc(quote.title)}</td></tr>
  ${quote.site_address ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Site</td><td>${esc(quote.site_address)}</td></tr>` : ''}
  ${[...sections].map(([name, amt]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${esc(name)}</td><td style="text-align:right">${zar(round2(amt))}</td></tr>`).join('')}
  ${Number(quote.discount) ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Discount</td><td style="text-align:right">-${zar(Number(quote.discount))}</td></tr>` : ''}
  <tr><td style="padding:4px 12px 4px 0;color:#64748b;border-top:1px solid #e2e8f0">Total excl. VAT</td><td style="text-align:right;border-top:1px solid #e2e8f0">${zar(totalExcl)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b">VAT (${Number(quote.vat_rate)}%)</td><td style="text-align:right">${zar(vat)}</td></tr>
  <tr><td style="padding:6px 12px 6px 0;font-weight:700">Total</td><td style="text-align:right;font-weight:700">${zar(totalIncl)}</td></tr>
  ${quote.valid_until ? `<tr><td colspan="2" style="padding-top:8px;color:#64748b;font-size:12px">Valid until ${esc(quote.valid_until)}</td></tr>` : ''}
</table>`
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">${esc(message).replace(/\n/g, '<br>')}${summary}</div>`
  const text = `${message}${clientPdf ? '' : `\n\nQuote ${quote.number ?? ''}: ${quote.title}\nTotal excl. VAT: ${zar(totalExcl)}\nVAT: ${zar(vat)}\nTotal: ${zar(totalIncl)}`}`

  let messageId: string | null = null
  try {
    if (own) {
      messageId = await sendFromOwnMailbox(own, me, { to, cc, subject, html, text, attachments: files })
    } else if (via === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to,
          cc: cc.length ? cc : undefined,
          reply_to: settings.email ?? undefined,
          subject,
          html,
          text,
          attachments: files.map((f) => ({ filename: f.filename, content: f.content.toString('base64'), content_type: f.contentType })),
        }),
      })
      if (!r.ok) {
        const detail = (await r.json().catch(() => null)) as { message?: string } | null
        throw new Error(detail?.message ?? `Resend answered HTTP ${r.status}`)
      }
    } else {
      const port = Number(SMTP_PORT || 465)
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: port === 465,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS ?? '' } : undefined,
      })
      await transporter.sendMail({
        from: FROM,
        to,
        cc: cc.length ? cc : undefined,
        replyTo: settings.email ?? undefined,
        subject,
        html,
        text,
        attachments: files,
      })
    }
  } catch (e) {
    console.error('Quote email failed', e)
    res.status(502).json({ error: `The email could not be sent: ${e instanceof Error ? e.message : String(e)}` })
    return
  }

  // On the client's Emails card too. With the Message-ID recorded, the client's reply to the quote
  // is filed on the same client when the person's mailbox syncs.
  await logEmailActivity(db, {
    userId: caller.user.id,
    companyId: quote.company_id,
    contactId: quote.contact_id,
    subject,
    notes: `${message}${files.length ? `\n\nAttached: ${files.map((f) => f.filename).join(', ')}` : ''}`.trim(),
    messageId,
  })

  // The email has already gone, so a failure here is reported as a warning rather than an error:
  // a 500 would invite a retry and the client would get the quote twice.
  const now = new Date().toISOString()
  const stamp = await db
    .from('quotes')
    .update({ sent_at: now, sent_to: [...to, ...cc].join(', '), updated_at: now, ...(quote.status === 'draft' ? { status: 'sent' } : {}) })
    .eq('id', quote.id)
    .select('id')
  if (stamp.error || !stamp.data?.length) {
    console.error('Quote sent but not stamped', quote.id, stamp.error)
    res.status(200).json({
      ok: true,
      attached: files.map((f) => f.filename),
      warning: `The email was sent, but the quote could not be marked as sent (${stamp.error?.message ?? "no permission"}). Use "Mark sent" instead of sending again.`,
    })
    return
  }

  res.status(200).json({ ok: true, attached: files.map((f) => f.filename) })
}

/**
 * The caller's connected mailbox, or null when they haven't connected one or the server can't use
 * it (no service-role key, or no usable EMAIL_CREDENTIALS_KEY). Null falls back to the company
 * sender, so a half-configured server never blocks a quote that could have gone out.
 */
async function ownMailbox(userId: string): Promise<MailboxConnection | null> {
  const admin = adminClient()
  if (!admin || credentialsKeyProblem()) return null
  return getConnection(admin, userId)
}
