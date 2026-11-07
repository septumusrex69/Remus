import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireCaller } from './auth.js'
import { keyedHash } from './crypto.js'
import { appendSignedPage, buildDocumentPdf, type Letterhead, type SignedMark } from './documentPdf.js'
import { logEmailActivity } from './mailbox.js'
import { EMAIL_RE, sendOfficeMail } from './officeMail.js'
import { buildQuotePdf, round2 } from './quotePdf.js'
import {
  callerIp, cleanSignerName, documentHash, escapeHtml, isSigningToken, newSigningToken, pdfName, quoteSigningText,
  signSubmitProblem, signedCopyEmail, signedNotice, signingClosedReason, signingDays, signingEmail, signingLink,
  variationSigningText,
} from './signingRules.js'

/**
 * THE LIBRARY'S DOCUMENTS AND ONLINE SIGNING, ON THE SERVER (Remus · Handover 8; Raptor's signing.ts,
 * signing_document / signing_sign and its signed-copy email, adapted).
 *
 * Served through the client portal's door (/api/portal/<action>, api/_lib/portal.ts) rather than a function of
 * its own: Vercel counts functions, and the portal is already the one place a visitor WITHOUT a login is
 * answered, by a token, with the service role. Two kinds of caller, never mixed:
 *
 *   anybody with the link   sign-open, sign-submit, sign-pdf            (the token is the authority)
 *   staff (a Remus login)   doc-pdf, doc-send, sign-create, sign-cancel, sign-signed-pdf
 *
 * STAFF READ AS THEMSELVES: the document, quote or variation is read with the caller's own session, so the
 * database's rules (a site manager sees no money) hold here exactly as on the screen. Only the signing rows are
 * written with the service role, because the anonymous signer must be answered by the server alone.
 *
 * THE TOKEN IS NEVER STORED (different from Raptor, the same as the portal's sessions): only keyedHash('signing',
 * token). The office gets the link once, when it is made.
 */

type Handler = (req: VercelRequest, res: VercelResponse, admin: SupabaseClient) => Promise<void>

const now = () => Date.now()
const UUID = /^[0-9a-f-]{36}$/i
const isId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

async function letterheadOf(admin: SupabaseClient): Promise<Letterhead & { bank_details?: string | null; vat_rate?: number; vat_registered?: boolean }> {
  const { data } = await admin.from('company_settings')
    .select('name, address, phone, email, reg_no, vat_no, logo_url, bank_details, vat_rate, vat_registered').eq('id', true).maybeSingle()
  return { ...(data ?? {}), name: (data?.name as string | undefined) || 'Urban Haus Construction' }
}

function origin(req: VercelRequest): string {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  return host ? `https://${String(host)}` : (process.env.APP_URL || 'https://remus-xi.vercel.app')
}

function sendPdf(res: VercelResponse, bytes: Uint8Array, filename: string) {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.status(200).send(Buffer.from(bytes))
}

/* ------------------------------------------------------------------ staff */

interface Staff { id: string; name: string; db: SupabaseClient }

/** Anybody active at Urban Haus who may write (not Read Only), reading as themselves. */
async function requireWriter(req: VercelRequest, res: VercelResponse, admin: SupabaseClient): Promise<Staff | null> {
  const caller = await requireCaller(req)
  if (!caller) { res.status(401).json({ error: 'Please sign in again.' }); return null }
  const { data: p } = await admin.from('profiles').select('id, name, role, status').eq('id', caller.user.id).maybeSingle()
  if (!p || p.status !== 'Active' || p.role === 'Read Only') {
    res.status(403).json({ error: 'Your access is read-only, so you cannot send documents.' }); return null
  }
  return { id: p.id as string, name: String(p.name ?? ''), db: caller.db }
}

interface DocRow {
  id: string; title: string; subject: string | null; body: string; signable: boolean; status: string
  project_id: string | null; company_id: string | null; contact_id: string | null; quote_id: string | null; variation_id: string | null
}

/** A document as the caller may see it (their own session, so the database's rules apply). */
async function readDocument(db: SupabaseClient, id: unknown): Promise<DocRow | null> {
  if (!isId(id)) return null
  const { data } = await db.from('project_documents')
    .select('id, title, subject, body, signable, status, project_id, company_id, contact_id, quote_id, variation_id').eq('id', id).maybeSingle()
  return (data as DocRow | null) ?? null
}

async function clientNameOf(db: SupabaseClient, ref: { company_id: string | null; contact_id: string | null }): Promise<string> {
  if (ref.company_id) {
    const { data } = await db.from('companies').select('name').eq('id', ref.company_id).maybeSingle()
    if (data?.name) return String(data.name)
  }
  if (ref.contact_id) {
    const { data } = await db.from('contacts').select('first_name, last_name').eq('id', ref.contact_id).maybeSingle()
    if (data) return [data.first_name, data.last_name].filter(Boolean).join(' ')
  }
  return ''
}

/**
 * A QUOTE'S WORDS, as signingRules.quoteSigningText writes them, with the quote's totals worked out the way the
 * quote_totals view and the quote PDF work them out. Read with whichever client is passed: the staff member's
 * when it is sent, the service role's when it is signed (to compare).
 */
async function quoteWords(db: SupabaseClient, quoteId: string): Promise<{ text: string; quote: Record<string, unknown>; totalExcl: number; client: string } | null> {
  const [{ data: quote }, { data: items }] = await Promise.all([
    db.from('quotes').select('*').eq('id', quoteId).maybeSingle(),
    db.from('quote_items').select('section, description, quantity, unit, unit_price').eq('quote_id', quoteId).order('sort_order'),
  ])
  if (!quote) return null
  const rows = (items ?? []) as { section: string | null; description: string; quantity: number; unit: string; unit_price: number }[]
  const raw = rows.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0)
  const fee = round2((raw * Number(quote.management_fee_pct || 0)) / 100)
  const rawExcl = raw + fee - Number(quote.discount || 0)
  const rate = Number(quote.vat_rate || 0)
  const totals = { totalExcl: round2(rawExcl), vat: round2((rawExcl * rate) / 100), totalIncl: round2(rawExcl * (1 + rate / 100)), vatRate: rate }
  const client = await clientNameOf(db, quote as { company_id: string | null; contact_id: string | null })
  const withFee = fee ? [...rows, { section: null, description: `Project management (${Number(quote.management_fee_pct)}%)`, quantity: 1, unit: 'item', unit_price: fee }] : rows
  const withDiscount = Number(quote.discount) ? [...withFee, { section: null, description: 'Discount', quantity: 1, unit: 'item', unit_price: -Number(quote.discount) }] : withFee
  const text = quoteSigningText({
    number: quote.number as string | null, title: String(quote.title ?? ''), site_address: quote.site_address as string | null,
    issue_date: quote.issue_date as string | null, valid_until: quote.valid_until as string | null,
    scope: quote.scope as string | null, terms: quote.terms as string | null, client, items: withDiscount, totals,
  })
  return { text, quote, totalExcl: totals.totalExcl, client }
}

/** A document's PDF, as the office sends it (unsigned). */
const docPdf: Handler = async (req, res, admin) => {
  const staff = await requireWriter(req, res, admin)
  if (!staff) return
  const doc = await readDocument(staff.db, (req.body ?? {}).id)
  if (!doc) { res.status(404).json({ error: 'That document could not be found.' }); return }
  const [lh, client] = await Promise.all([letterheadOf(admin), clientNameOf(staff.db, doc)])
  try {
    const bytes = await buildDocumentPdf({ letterhead: lh, title: doc.title, body: doc.body, signable: doc.signable, clientName: client })
    sendPdf(res, bytes, pdfName(doc.title, false))
  } catch (e) {
    console.error('[documents] PDF failed', e)
    res.status(500).json({ error: 'The PDF could not be made just now. Try again.' })
  }
}

function recipients(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : []
}

/** Email a document as a PDF, the way a quote goes (own mailbox, else the company sender). */
const docSend: Handler = async (req, res, admin) => {
  const staff = await requireWriter(req, res, admin)
  if (!staff) return
  const body = req.body ?? {}
  const doc = await readDocument(staff.db, body.id)
  if (!doc) { res.status(404).json({ error: 'That document could not be found.' }); return }
  const to = recipients(body.to)
  const cc = recipients(body.cc)
  const bad = [...to, ...cc].find((e) => !EMAIL_RE.test(e))
  if (!to.length) { res.status(400).json({ error: 'Type at least one email address.' }); return }
  if (bad) { res.status(400).json({ error: `"${bad}" is not a valid email address.` }); return }
  if (to.length + cc.length > 10) { res.status(400).json({ error: 'Too many recipients.' }); return }
  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim().slice(0, 200) : doc.title
  const message = typeof body.message === 'string' ? body.message.slice(0, 5000) : ''
  const [lh, client] = await Promise.all([letterheadOf(admin), clientNameOf(staff.db, doc)])
  let bytes: Uint8Array
  try {
    bytes = await buildDocumentPdf({ letterhead: lh, title: doc.title, body: doc.body, signable: doc.signable, clientName: client })
  } catch (e) {
    console.error('[documents] PDF failed', e)
    res.status(500).json({ error: 'The PDF could not be made, so nothing was sent. Try again.' }); return
  }
  const filename = pdfName(doc.title, false)
  const sent = await sendOfficeMail(admin, staff.id, {
    to, cc, subject, replyTo: lh.email ?? null,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">${escapeHtml(message).replace(/\n/g, '<br>')}</div>`,
    text: message,
    attachments: [{ filename, content: Buffer.from(bytes), contentType: 'application/pdf' }],
  })
  if (!sent.ok) { res.status(502).json({ error: sent.error }); return }
  await logEmailActivity(staff.db, {
    userId: staff.id, companyId: doc.company_id, contactId: doc.contact_id, subject,
    notes: `${message}\n\nAttached: ${filename}`.trim(), messageId: sent.messageId,
  })
  const at = new Date(now()).toISOString()
  await staff.db.from('project_documents')
    .update({ sent_at: at, sent_to: [...to, ...cc].join(', '), updated_at: at, ...(doc.status === 'draft' ? { status: 'sent' } : {}) })
    .eq('id', doc.id)
  res.status(200).json({ ok: true, from: sent.from, attached: [filename] })
}

/**
 * SEND FOR SIGNING: a Library document, a quote or a variation. The words are frozen and fingerprinted here,
 * the link is made, and (when asked) emailed with a button. The link comes back to the office once, to copy or
 * to WhatsApp.
 */
const signCreate: Handler = async (req, res, admin) => {
  const staff = await requireWriter(req, res, admin)
  if (!staff) return
  const body = req.body ?? {}
  const source = body.source
  if (source !== 'document' && source !== 'quote' && source !== 'variation') { res.status(400).json({ error: 'What is being signed?' }); return }
  if (!isId(body.id)) { res.status(400).json({ error: 'Which one is being signed?' }); return }
  const signerName = cleanSignerName(body.signerName) || null
  const signerEmail = typeof body.signerEmail === 'string' && body.signerEmail.trim() ? body.signerEmail.trim().toLowerCase() : null
  if (signerEmail && !EMAIL_RE.test(signerEmail)) { res.status(400).json({ error: `"${signerEmail}" is not a valid email address.` }); return }
  if (body.email === true && !signerEmail) { res.status(400).json({ error: 'Type the email address to send the link to.' }); return }

  const lh = await letterheadOf(admin)
  let row: Record<string, unknown>
  if (source === 'document') {
    const doc = await readDocument(staff.db, body.id)
    if (!doc) { res.status(404).json({ error: 'That document could not be found.' }); return }
    if (!doc.body.trim()) { res.status(400).json({ error: 'The document is empty.' }); return }
    row = { source, document_id: doc.id, quote_id: doc.quote_id, variation_id: doc.variation_id, project_id: doc.project_id, company_id: doc.company_id, contact_id: doc.contact_id, title: doc.title, body: doc.body }
  } else if (source === 'quote') {
    const words = await quoteWords(staff.db, body.id)
    if (!words) { res.status(404).json({ error: 'That quote could not be found.' }); return }
    const q = words.quote
    if (!['draft', 'sent'].includes(String(q.status))) { res.status(409).json({ error: 'Only a draft or sent quote can go for signing.' }); return }
    /* THE SAME SIGN-OFF AS SENDING (api/quotes/send.ts, 0011): only a quote approved at this total goes out. */
    if (!q.approved_at || q.approved_total === null || round2(Number(q.approved_total)) !== words.totalExcl) {
      res.status(409).json({ error: 'This quote needs approving at its current total before it is sent (Totals → Approve).' }); return
    }
    row = { source, quote_id: q.id, project_id: q.project_id ?? null, company_id: q.company_id ?? null, contact_id: q.contact_id ?? null, title: `Quotation ${q.number ?? ''}`.trim(), body: words.text }
  } else {
    const { data: v } = await staff.db.from('variations').select('id, project_id, description, amount_excl, date').eq('id', body.id).maybeSingle()
    if (!v) { res.status(404).json({ error: 'That variation could not be found.' }); return }
    const { data: p } = await staff.db.from('projects').select('id, name, code, site_address, company_id, contact_id').eq('id', v.project_id).maybeSingle()
    const client = p ? await clientNameOf(staff.db, p as { company_id: string | null; contact_id: string | null }) : ''
    const rate = lh.vat_registered === false ? 0 : Number(lh.vat_rate ?? 15)
    row = {
      source, variation_id: v.id, project_id: v.project_id, company_id: p?.company_id ?? null, contact_id: p?.contact_id ?? null,
      title: `Variation order: ${String(v.description).slice(0, 60)}`,
      body: variationSigningText({ description: String(v.description), amount_excl: Number(v.amount_excl), date: String(v.date), vatRate: rate, project: String(p?.name ?? ''), site: (p?.site_address as string | null) ?? null, client, company: lh.name ?? 'Urban Haus' }),
    }
  }

  const token = newSigningToken()
  const expiresAt = new Date(now() + signingDays(body.days) * 86_400_000).toISOString()
  const { data: made, error } = await admin.from('signing_requests').insert({
    ...row, token_hash: keyedHash('signing', token), body_hash: documentHash(String(row.body)),
    signer_name: signerName, signer_email: signerEmail, expires_at: expiresAt, created_by: staff.id,
  }).select('id').single()
  if (error || !made) { console.error('[signing] could not save', error?.message); res.status(500).json({ error: 'The signing link could not be made just now. Try again.' }); return }
  const url = signingLink(token, origin(req))

  let emailed = false
  let emailError: string | null = null
  if (body.email === true && signerEmail) {
    const mail = signingEmail({ company: lh.name ?? 'Urban Haus', signerName, title: String(row.title), url, message: typeof body.message === 'string' ? body.message.slice(0, 3000) : null, expiresAt, from: staff.name })
    const sent = await sendOfficeMail(admin, staff.id, { to: [signerEmail], subject: typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim().slice(0, 200) : mail.subject, html: mail.html, text: mail.text, replyTo: lh.email ?? null })
    if (sent.ok) {
      emailed = true
      await admin.from('signing_requests').update({ emailed_at: new Date(now()).toISOString() }).eq('id', made.id)
      await logEmailActivity(staff.db, { userId: staff.id, companyId: (row.company_id as string | null) ?? null, contactId: (row.contact_id as string | null) ?? null, subject: mail.subject, notes: mail.text, messageId: sent.messageId })
    } else emailError = sent.error
  }
  /* Sending it is sending it: a draft document or quote becomes 'sent', as a quote does when it is emailed. */
  const at = new Date(now()).toISOString()
  if (source === 'document') {
    await staff.db.from('project_documents').update({ status: 'sent', sent_at: at, ...(signerEmail ? { sent_to: signerEmail } : {}), updated_at: at }).eq('id', body.id).eq('status', 'draft')
  } else if (source === 'quote') {
    await staff.db.from('quotes').update({ status: 'sent', sent_at: at, ...(signerEmail ? { sent_to: signerEmail } : {}), updated_at: at }).eq('id', body.id).eq('status', 'draft')
  }
  console.log(`[signing] request ${made.id} (${source}) made by ${staff.id}${emailed ? ', emailed' : ''}`)
  res.status(200).json({ id: made.id, url, expiresAt, emailed, emailError })
}

/** Withdraw a link that has not been signed: it then says "withdrawn" to whoever opens it. */
const signCancel: Handler = async (req, res, admin) => {
  const staff = await requireWriter(req, res, admin)
  if (!staff) return
  const id = (req.body ?? {}).id
  if (!isId(id)) { res.status(400).json({ error: 'Which request?' }); return }
  /* Read as the caller first, so a person can only withdraw what they can see. */
  const { data: mine } = await staff.db.from('signing_requests').select('id').eq('id', id).maybeSingle()
  if (!mine) { res.status(404).json({ error: 'That request could not be found.' }); return }
  const { data, error } = await admin.from('signing_requests').update({ state: 'cancelled', cancelled_at: new Date(now()).toISOString() })
    .eq('id', id).eq('state', 'sent').select('id').maybeSingle()
  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(409).json({ error: 'It was already signed or withdrawn.' }); return }
  res.status(200).json({ ok: true })
}

/* ------------------------------------------------------------------ the signed PDF (both sides) */

interface SigningRow {
  id: string; source: string; document_id: string | null; quote_id: string | null; variation_id: string | null
  project_id: string | null; company_id: string | null; contact_id: string | null
  title: string; body: string; body_hash: string; signer_name: string | null; signer_email: string | null
  state: string; expires_at: string; opened_at: string | null; open_count: number
  signed_at: string | null; signed_name: string | null; signature_png: string | null; signed_ip: string | null; signed_hash: string | null
  created_by: string | null; copy_sent_at: string | null
}
const ROW = 'id, source, document_id, quote_id, variation_id, project_id, company_id, contact_id, title, body, body_hash, signer_name, signer_email, state, expires_at, opened_at, open_count, signed_at, signed_name, signature_png, signed_ip, signed_hash, created_by, copy_sent_at'

function markOf(r: SigningRow): SignedMark | null {
  if (r.state !== 'signed' || !r.signed_at || !r.signed_name || !r.signature_png) return null
  return { name: r.signed_name, at: r.signed_at, ip: r.signed_ip, pngDataUrl: r.signature_png, hash: r.signed_hash ?? r.body_hash, reference: r.id }
}

/** The PDF of a signing request: the frozen words on the letterhead (a quote: its own PDF), signed if it is. */
async function signingPdf(admin: SupabaseClient, r: SigningRow): Promise<{ bytes: Uint8Array; filename: string }> {
  const lh = await letterheadOf(admin)
  const mark = markOf(r)
  if (r.source === 'quote' && r.quote_id) {
    try {
      const q = await buildQuotePdf(admin, r.quote_id)
      const bytes = mark ? await appendSignedPage(q.bytes, { letterhead: lh, title: r.title, mark }) : q.bytes
      return { bytes, filename: mark ? q.filename.replace(/\.pdf$/i, '-signed.pdf') : q.filename }
    } catch {
      /* the quote was deleted since: the frozen words still make the document */
    }
  }
  const client = await clientNameOf(admin, r)
  const bytes = await buildDocumentPdf({ letterhead: lh, title: r.title, body: r.body, signable: true, clientName: client, signed: mark })
  return { bytes, filename: pdfName(r.title, !!mark) }
}

const signSignedPdf: Handler = async (req, res, admin) => {
  const staff = await requireWriter(req, res, admin)
  if (!staff) return
  const id = (req.body ?? {}).id
  if (!isId(id)) { res.status(400).json({ error: 'Which request?' }); return }
  const { data: mine } = await staff.db.from('signing_requests').select('id').eq('id', id).maybeSingle()
  if (!mine) { res.status(404).json({ error: 'That request could not be found.' }); return }
  const { data } = await admin.from('signing_requests').select(ROW).eq('id', id).maybeSingle()
  if (!data) { res.status(404).json({ error: 'That request could not be found.' }); return }
  try {
    const pdf = await signingPdf(admin, data as SigningRow)
    sendPdf(res, pdf.bytes, pdf.filename)
  } catch (e) {
    console.error('[signing] PDF failed', e)
    res.status(500).json({ error: 'The PDF could not be made just now. Try again.' })
  }
}

/* ------------------------------------------------------------------ anybody with the link */

async function byToken(admin: SupabaseClient, token: unknown): Promise<SigningRow | null> {
  if (!isSigningToken(token)) return null
  const { data } = await admin.from('signing_requests').select(ROW).eq('token_hash', keyedHash('signing', token)).maybeSingle()
  return (data as SigningRow | null) ?? null
}

/**
 * OPENING THE LINK. What the signer may see and nothing else (Raptor's signing_open): the words, the company's
 * letterhead, the name it was made out to, and whether it can still be signed -- never the creator, the
 * client's ids or the fingerprint machinery. The first opening is recorded so the office sees "opened".
 */
const signOpen: Handler = async (req, res, admin) => {
  const r = await byToken(admin, (req.body ?? {}).token)
  if (!r) { res.status(404).json({ error: 'This link is not one we can open. Check that it was copied whole, or ask us to send it again.' }); return }
  const lh = await letterheadOf(admin)
  const t = now()
  if (r.state === 'sent' && Date.parse(r.expires_at) > t) {
    await admin.from('signing_requests').update({ opened_at: r.opened_at ?? new Date(t).toISOString(), open_count: Number(r.open_count ?? 0) + 1 }).eq('id', r.id)
  }
  res.status(200).json({
    title: r.title, body: r.body, source: r.source, signerName: r.signer_name,
    state: r.state, expiresAt: r.expires_at, closed: signingClosedReason(r, t),
    signedAt: r.signed_at, signedName: r.signed_name, signaturePng: r.state === 'signed' ? r.signature_png : null,
    company: { name: lh.name, address: lh.address ?? null, phone: lh.phone ?? null, email: lh.email ?? null, regNo: lh.reg_no ?? null, vatNo: lh.vat_no ?? null, logoUrl: lh.logo_url ?? null },
  })
}

/**
 * SIGNING IT. Once, and the database is what enforces that: the update only lands while the state is still
 * 'sent' and the link has not expired, so a double tap or a forwarded link opened twice changes nothing.
 * The words are fingerprinted again; for a quote they are re-made from the quote as it is now, and a quote
 * changed since the link went out is refused rather than accepted at a price nobody agreed.
 */
const signSubmit: Handler = async (req, res, admin) => {
  const body = req.body ?? {}
  const problem = signSubmitProblem({ name: body.name, signature: body.signature, agreed: body.agreed })
  if (problem) { res.status(400).json({ error: problem }); return }
  const r = await byToken(admin, body.token)
  if (!r) { res.status(404).json({ error: 'This link is not one we can open.' }); return }
  const t = now()
  const closed = signingClosedReason(r, t)
  if (closed) { res.status(409).json({ error: closed }); return }

  const hash = documentHash(r.body)
  if (hash !== r.body_hash) { res.status(409).json({ error: 'This document could not be checked. Please ask us to send it again.' }); return }
  if (r.source === 'quote' && r.quote_id) {
    const words = await quoteWords(admin, r.quote_id)
    if (!words || documentHash(words.text) !== r.body_hash) {
      res.status(409).json({ error: 'This quote was changed after it was sent to you, so it cannot be signed on this link. Please ask us for a new one.' }); return
    }
  }

  const name = cleanSignerName(body.name)
  const at = new Date(t).toISOString()
  const { data: done, error } = await admin.from('signing_requests').update({
    state: 'signed', signed_at: at, signed_name: name, signature_png: body.signature,
    signed_ip: callerIp(req.headers) || null, signed_agent: String(req.headers['user-agent'] ?? '').slice(0, 400), signed_hash: hash,
  }).eq('id', r.id).eq('state', 'sent').gt('expires_at', at).select('id').maybeSingle()
  if (error) { res.status(500).json({ error: 'Your signature could not be saved just now. Try again.' }); return }
  /* NOT A FAULT (Raptor): somebody pressed twice, or it was signed a moment ago. The page re-reads and says so. */
  if (!done) { res.status(409).json({ error: 'This document has already been signed.' }); return }

  /* What a signature means for the thing signed. Each is best effort: the signature itself is already kept. */
  const effects: PromiseLike<unknown>[] = []
  if (r.document_id) effects.push(admin.from('project_documents').update({ status: 'signed', updated_at: at }).eq('id', r.document_id))
  if (r.source === 'quote' && r.quote_id) {
    /* Like the portal's accept (0042): only a quote still 'sent' becomes accepted; accepted_via stays as 0042 allows. */
    effects.push(admin.from('quotes').update({ status: 'accepted', accepted_at: at, accepted_by_name: name, accepted_signing_id: r.id, updated_at: at })
      .eq('id', r.quote_id).eq('status', 'sent'))
  }
  if (r.variation_id && (r.source === 'variation' || r.source === 'document')) {
    effects.push(admin.from('variations').update({ approved: true }).eq('id', r.variation_id))
  }
  const client = await clientNameOf(admin, r)
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'Administrator').eq('status', 'Active')
  const told = new Set<string>([...(admins ?? []).map((a) => a.id as string), ...(r.created_by ? [r.created_by] : [])])
  const link = r.project_id ? `/projects/${r.project_id}?tab=documents` : r.quote_id ? `/quotes/${r.quote_id}` : null
  if (told.size) {
    effects.push(admin.from('notifications').insert([...told].map((uid) => ({
      user_id: uid, type: 'document.signed', message: signedNotice({ name, title: r.title, client }), link,
    }))))
  }
  const results = await Promise.allSettled(effects)
  for (const x of results) if (x.status === 'rejected') console.error('[signing] after-signing step failed', x.reason)
  console.log(`[signing] request ${r.id} signed`)

  /* THE SIGNER'S OWN COPY (Raptor's signed-copy email), from the person who sent it. Best effort, never a fault. */
  if (r.signer_email && r.created_by) {
    try {
      const lh = await letterheadOf(admin)
      const pdf = await signingPdf(admin, { ...r, state: 'signed', signed_at: at, signed_name: name, signature_png: body.signature, signed_ip: callerIp(req.headers) || null, signed_hash: hash })
      const mail = signedCopyEmail({ company: lh.name ?? 'Urban Haus', signerName: name, title: r.title })
      const sent = await sendOfficeMail(admin, r.created_by, { to: [r.signer_email], subject: mail.subject, html: mail.html, text: mail.text, replyTo: lh.email ?? null, attachments: [{ filename: pdf.filename, content: Buffer.from(pdf.bytes), contentType: 'application/pdf' }] })
      if (sent.ok) await admin.from('signing_requests').update({ copy_sent_at: new Date(now()).toISOString() }).eq('id', r.id)
      else console.error(`[signing] request ${r.id}: signed copy not emailed: ${sent.error}`)
    } catch (e) {
      console.error(`[signing] request ${r.id}: signed copy not emailed`, e)
    }
  }
  res.status(200).json({ ok: true, signedAt: at })
}

/** The document's PDF for the signer: to read before signing, or their signed copy after. */
const signPdfForSigner: Handler = async (req, res, admin) => {
  const r = await byToken(admin, (req.body ?? {}).token)
  if (!r || r.state === 'cancelled') { res.status(404).json({ error: 'This link is not one we can open.' }); return }
  try {
    const pdf = await signingPdf(admin, r)
    sendPdf(res, pdf.bytes, pdf.filename)
  } catch (e) {
    console.error('[signing] PDF failed', e)
    res.status(500).json({ error: 'The PDF could not be made just now. Try again.' })
  }
}

/** Added to the portal's routes (api/_lib/portal.ts). */
export const SIGNING_ROUTES: Record<string, Handler> = {
  'doc-pdf': docPdf,
  'doc-send': docSend,
  'sign-create': signCreate,
  'sign-cancel': signCancel,
  'sign-signed-pdf': signSignedPdf,
  'sign-open': signOpen,
  'sign-submit': signSubmit,
  'sign-pdf': signPdfForSigner,
}
