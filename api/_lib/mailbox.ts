import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ImapFlow, type ListResponse } from 'imapflow'
import nodemailer from 'nodemailer'
import { decrypt } from './crypto.js'

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

function findFolder(mailboxes: ListResponse[], specialUse: string, commonNames: string[]): string | undefined {
  const bySpecialUse = mailboxes.find((m) => m.specialUse === specialUse)
  if (bySpecialUse) return bySpecialUse.path
  const byName = mailboxes.find((m) => commonNames.includes(m.name.toLowerCase()) || commonNames.includes(m.path.toLowerCase()))
  return byName?.path
}

/**
 * Files a copy of a sent message in the mailbox's Sent folder, so it shows in the person's own
 * mail client too. SMTP alone never does that: the server relays the message and keeps nothing.
 */
export async function appendToSent(conn: MailboxConnection, rawMessage: Buffer): Promise<void> {
  const client = imapClient(conn, decrypt(conn.encrypted_password))
  await client.connect()
  try {
    const mailboxes = await client.list()
    const sentPath = findFolder(mailboxes, '\\Sent', ['sent', 'sent items', 'sent messages', 'inbox.sent', 'inbox/sent'])
    if (!sentPath) return
    await client.append(sentPath, rawMessage, ['\\Seen'])
  } finally {
    await client.logout().catch(() => {})
  }
}
