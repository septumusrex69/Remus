import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ImapFlow, type ListResponse } from 'imapflow'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { decrypt } from './crypto.js'
import { SIGNATURE_CID, composeBody, fetchSignatureImage, signatureHtml } from './signature.js'

/**
 * Each person's own mailbox, as in Raptor (api/email/* and api/_lib/emailSync.ts there).
 *
 * email_connections has no RLS policies, so reading it needs the service-role key. Everything here
 * is server-side only; the browser only ever learns whether a mailbox is connected and its address.
 */

export interface MailboxConnection {
  user_id: string
  email: string
  smtp_host: string
  smtp_port: number
  imap_host: string
  imap_port: number
  encrypted_password: string
  last_synced_at?: string | null
}

/** Service-role client, or null when SUPABASE_SERVICE_ROLE_KEY isn't set. */
export function adminClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function getConnection(admin: SupabaseClient, userId: string): Promise<MailboxConnection | null> {
  const { data } = await admin.from('email_connections').select('*').eq('user_id', userId).maybeSingle()
  return (data as MailboxConnection | null) ?? null
}

/** Port 465 is implicit TLS; anything else (587, 25) starts plain and upgrades with STARTTLS. */
export function smtpTransport(c: { email: string; smtp_host: string; smtp_port: number }, password: string) {
  return nodemailer.createTransport({
    host: c.smtp_host,
    port: c.smtp_port,
    secure: c.smtp_port === 465,
    auth: { user: c.email, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  })
}

export function imapClient(c: { email: string; imap_host: string; imap_port: number }, password: string) {
  return new ImapFlow({
    host: c.imap_host,
    port: c.imap_port,
    secure: c.imap_port === 993,
    auth: { user: c.email, pass: password },
    logger: false,
  })
}

export function findFolder(mailboxes: ListResponse[], specialUse: string, commonNames: string[]): string | undefined {
  const bySpecialUse = mailboxes.find((m) => m.specialUse === specialUse)
  if (bySpecialUse) return bySpecialUse.path
  const byName = mailboxes.find((m) => commonNames.includes(m.name.toLowerCase()) || commonNames.includes(m.path.toLowerCase()))
  return byName?.path
}

/** Where a Sent copy was filed: the folder and, where the server says (UIDPLUS), its uid. */
export type SentCopy = { folder: string; uid: number | null }

/**
 * Files a copy of a sent message in the mailbox's Sent folder, so it shows in the person's own
 * mail client too. SMTP alone never does that: the server relays the message and keeps nothing.
 * Says WHERE it went (Raptor S15), or null when the mailbox has no Sent folder.
 */
export async function appendToSent(conn: MailboxConnection, rawMessage: Buffer): Promise<SentCopy | null> {
  const client = imapClient(conn, decrypt(conn.encrypted_password))
  await client.connect()
  try {
    const mailboxes = await client.list()
    const sentPath = findFolder(mailboxes, '\\Sent', ['sent', 'sent items', 'sent messages', 'inbox.sent', 'inbox/sent'])
    if (!sentPath) return null
    const r = await client.append(sentPath, rawMessage, ['\\Seen'])
    const uid = r && typeof r === 'object' && typeof (r as { uid?: unknown }).uid === 'number' ? (r as { uid: number }).uid : null
    return { folder: sentPath, uid }
  } finally {
    await client.logout().catch(() => {})
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export type SenderProfile = {
  name?: string | null
  email_signature?: string | null
  email_signature_image_url?: string | null
  email_signature_image_width?: number | null
  email_signature_image_align?: 'left' | 'center' | 'right' | null
} | null

/**
 * Sends from the person's own mailbox, as in Raptor's api/email/send.ts: their name and address
 * on the From line, their signature (image embedded, not linked), and a copy in their Sent folder.
 * Used by quotes and by client emails. Returns the message's Message-ID, so a reply can be filed
 * on the same client.
 */
export async function sendFromOwnMailbox(
  conn: MailboxConnection,
  me: SenderProfile,
  msg: {
    to: string[]
    cc: string[]
    subject: string
    html: string
    text: string
    attachments: { filename: string; content: Buffer; contentType?: string }[]
    /** Message-ID being answered: threads the reply under it in the client's mail app. */
    inReplyTo?: string | null
  },
): Promise<string | null> {
  return (await sendFromOwnMailboxReporting(conn, me, msg)).messageId
}

/**
 * The same send, also saying where the Sent copy was filed (Raptor S15). Stephan's forward in Raptor
 * was reported sent and never reached Sent Items: a copy that was not filed looked exactly like one
 * that was. `sentCopy` is null when it was not filed, and the reason is logged.
 */
export async function sendFromOwnMailboxReporting(
  conn: MailboxConnection,
  me: SenderProfile,
  msg: Parameters<typeof sendFromOwnMailbox>[2],
): Promise<{ messageId: string | null; sentCopy: SentCopy | null; html: string }> {
  const imageUrl = me?.email_signature_image_url ?? null
  const image = imageUrl ? { width: me?.email_signature_image_width ?? 160, align: me?.email_signature_image_align ?? 'left' } : null
  const embedded = imageUrl ? await fetchSignatureImage(imageUrl) : null
  const imageSrc = imageUrl ? (embedded ? `cid:${SIGNATURE_CID}` : imageUrl) : null
  const signature = signatureHtml(me?.email_signature ? esc(me.email_signature) : null, image, imageSrc)

  const name = me?.name?.trim()
  const mail = {
    from: name ? { name, address: conn.email } : conn.email,
    to: msg.to,
    cc: msg.cc.length ? msg.cc : undefined,
    subject: msg.subject,
    html: composeBody(msg.html, signature),
    text: me?.email_signature ? `${msg.text}\n\n${me.email_signature}` : msg.text,
    attachments: [
      ...msg.attachments,
      ...(embedded ? [{ filename: 'signature', content: embedded.content, contentType: embedded.contentType, cid: SIGNATURE_CID }] : []),
    ],
    ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo, references: msg.inReplyTo } : {}),
  }
  const info = await smtpTransport(conn, decrypt(conn.encrypted_password)).sendMail(mail)
  const messageId = (info.messageId as string | undefined) ?? null

  // Best effort: the message has already gone, so failing to file the copy is never a send error --
  // but it is logged with its reason and returned, so the screen can say so (Raptor S15).
  // The copy carries the same Message-ID, so it is the same message in the person's mail app.
  let sentCopy: SentCopy | null = null
  try {
    const raw = await new MailComposer({ ...mail, messageId: messageId ?? undefined }).compile().build()
    sentCopy = await appendToSent(conn, raw)
    if (!sentCopy) console.error(`[mailbox] ${conn.email}: no Sent folder found, so no Sent copy was filed`)
  } catch (e) {
    console.error(`[mailbox] ${conn.email}: email sent, but not filed in Sent: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { messageId, sentCopy, html: mail.html }
}

/** Room for a long business email, while refusing to store a runaway newsletter or quoted chain. */
export const EMAIL_NOTES_MAX_LENGTH = 20000

/**
 * Records a sent email on the client's Emails card (an `activities` row, as in Raptor).
 * Best effort: the email has already gone, so a failure is logged, never thrown.
 */
export async function logEmailActivity(
  db: SupabaseClient,
  e: { userId: string; companyId: string | null; contactId: string | null; subject: string; notes: string; messageId: string | null },
): Promise<string | null> {
  if (!e.companyId && !e.contactId) return null
  const { data, error } = await db
    .from('activities')
    .insert({
      type: 'Email',
      user_id: e.userId,
      company_id: e.companyId,
      contact_id: e.contactId,
      subject: `Email sent: ${e.subject}`,
      notes: e.notes.slice(0, EMAIL_NOTES_MAX_LENGTH),
      email_message_id: e.messageId,
      is_read: true,
    })
    .select('id')
    .maybeSingle()
  if (error) console.error('Email sent, but not logged on the client', error.message)
  return (data?.id as string | undefined) ?? null
}
