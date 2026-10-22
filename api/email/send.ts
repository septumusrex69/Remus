import type { VercelRequest, VercelResponse } from '@vercel/node'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { decrypt, credentialsKeyProblem } from '../_lib/crypto.js'
import { appendToSent } from '../_lib/emailSync.js'
import { SIGNATURE_CID, composeBody, fetchSignatureImage, signatureHtml } from '../_lib/signature.js'

/**
 * Sends an email through the caller's own connected mailbox via SMTP, with their saved signature
 * appended, and logs it on the client's email history.
 *
 * POST { to, subject, body, companyId?, contactId?, inReplyTo? }
 *
 * Differs from Raptor's in two small ways: the body arrives as plain text and is escaped here
 * (so typing "<" can't break the message), and the activity is logged server-side in the same
 * call rather than by the browser afterwards, so a send can't go out unrecorded.
 */

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const NOTES_MAX_LENGTH = 20000

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Email is not set up on the server: SUPABASE_SERVICE_ROLE_KEY is missing.' })
    return
  }
  // A missing key is a server problem and has to say so, not surface as an empty 500.
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) {
    res.status(500).json({ error: keyProblem })
    return
  }
  const caller = await requireCaller(req)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { to, subject, body, companyId, contactId, inReplyTo } = (req.body ?? {}) as {
    to?: string
    subject?: string
    body?: string
    companyId?: string | null
    contactId?: string | null
    inReplyTo?: string | null
  }
  if (!to || !subject?.trim() || !body?.trim()) {
    res.status(400).json({ error: 'to, subject, and body are required.' })
    return
  }
  if (!EMAIL_RE.test(to.trim())) {
    res.status(400).json({ error: `"${to}" is not a valid email address.` })
    return
  }

  const { data: conn } = await admin.from('email_connections').select('*').eq('user_id', caller.user.id).maybeSingle()
  if (!conn) {
    res.status(400).json({ error: 'Connect your mailbox in Settings before sending email.' })
    return
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align')
    .eq('id', caller.user.id)
    .maybeSingle()
  const signatureText = profile?.email_signature as string | null | undefined
  const signatureImageUrl = profile?.email_signature_image_url as string | null | undefined
  const signatureImageWidth = (profile?.email_signature_image_width as number | null | undefined) ?? 160
  const signatureImageAlign = (profile?.email_signature_image_align as 'left' | 'center' | 'right' | null | undefined) ?? 'left'

  // The signature image travels inside the message (see signature.ts): a linked image shows as
  // a blocked grey box in Outlook/Gmail. If the fetch fails the message still goes, linked.
  const image = signatureImageUrl ? { width: signatureImageWidth, align: signatureImageAlign } : null
  const embedded = signatureImageUrl ? await fetchSignatureImage(signatureImageUrl) : null
  const imageSrc = signatureImageUrl ? (embedded ? `cid:${SIGNATURE_CID}` : signatureImageUrl) : null
  const attachments = embedded
    ? [{ filename: 'signature', content: embedded.content, contentType: embedded.contentType, cid: SIGNATURE_CID }]
    : undefined

  const cleanSubject = subject.trim().slice(0, 300)
  const bodyText = body.trim()
  const bodyHtml = `<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5">${esc(bodyText).replace(/\n/g, '<br>')}</div>`
  const fullHtml = composeBody(bodyHtml, signatureHtml(signatureText, image, imageSrc))
  // Replying: these headers make the message thread under the original in the client's mail app.
  const threading = inReplyTo ? { inReplyTo, references: inReplyTo } : {}
  const message = { from: conn.email as string, to: to.trim(), subject: cleanSubject, html: fullHtml, attachments, ...threading }

  let sentMessageId: string | null = null
  try {
    const transporter = nodemailer.createTransport({
      host: conn.smtp_host as string,
      port: conn.smtp_port as number,
      secure: (conn.smtp_port as number) === 465,
      auth: { user: conn.email as string, pass: decrypt(conn.encrypted_password as string) },
    })
    const info = await transporter.sendMail(message)
    // Kept so an inbound reply carrying this value in In-Reply-To is filed on the same client.
    sentMessageId = info.messageId ?? null
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to send email.' })
    return
  }

  // File it on the person the email went to when the page didn't say (e.g. a company page
  // emailing one of its people), so it also shows on that person's own page.
  let fileContactId = contactId ?? null
  let fileCompanyId = companyId ?? null
  if (!fileContactId) {
    const address = to.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)
    const { data: person } = await caller.db.from('contacts').select('id, company_id').ilike('email', address).limit(1).maybeSingle()
    if (person) {
      fileContactId = person.id as string
      fileCompanyId = fileCompanyId ?? ((person.company_id as string | null) ?? null)
    }
  }

  // Logged as the caller (RLS applies). The email already went out, so a failure here is
  // reported alongside ok: true rather than as a send failure.
  const { data: logged, error: logError } = await caller.db
    .from('activities')
    .insert({
      type: 'Email',
      user_id: caller.user.id,
      company_id: fileCompanyId,
      contact_id: fileContactId,
      subject: `Email sent: ${cleanSubject}`,
      notes: bodyText.slice(0, NOTES_MAX_LENGTH),
      email_message_id: sentMessageId,
      is_read: true,
    })
    .select('id')
    .maybeSingle()

  // Best-effort: file a copy in the mailbox's Sent folder so it shows in the person's own mail
  // app too. SMTP never does that by itself. A failure here doesn't undo the send.
  try {
    const raw = await new MailComposer({ ...message, messageId: sentMessageId ?? undefined }).compile().build()
    await appendToSent(
      { email: conn.email as string, imap_host: conn.imap_host as string, imap_port: conn.imap_port as number, encrypted_password: conn.encrypted_password as string },
      raw,
    )
  } catch {
    // ignore -- the send itself already succeeded
  }

  res.status(200).json({ ok: true, messageId: sentMessageId, activityId: logged?.id ?? null, logError: logError?.message ?? null })
}
