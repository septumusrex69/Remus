import nodemailer from 'nodemailer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { credentialsKeyProblem } from './crypto.js'
import { getConnection, sendFromOwnMailbox } from './mailbox.js'

/**
 * SENDING A DOCUMENT THE WAY A QUOTE IS SENT (Remus · Handover 8). The same path as api/quotes/send.ts: from
 * the person's own connected mailbox with their signature (and a copy in their Sent folder), otherwise from the
 * company sender (Resend's API, or SMTP). Written out here rather than imported, because send.ts keeps its
 * sender inside its own handler; the order and the settings are the same.
 */
export interface OfficeMail {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  text: string
  attachments?: { filename: string; content: Buffer; contentType?: string }[]
  replyTo?: string | null
}

export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

export async function sendOfficeMail(admin: SupabaseClient, userId: string, msg: OfficeMail): Promise<{ ok: true; messageId: string | null; from: string } | { ok: false; error: string }> {
  const attachments = msg.attachments ?? []
  const cc = msg.cc ?? []
  try {
    const conn = credentialsKeyProblem() ? null : await getConnection(admin, userId)
    if (conn) {
      const { data: me } = await admin.from('profiles')
        .select('name, email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align').eq('id', userId).maybeSingle()
      const messageId = await sendFromOwnMailbox(conn, me, { to: msg.to, cc, subject: msg.subject, html: msg.html, text: msg.text, attachments })
      return { ok: true, messageId, from: conn.email }
    }
    const env = process.env
    const from = env.EMAIL_FROM || env.SMTP_FROM || ''
    if (env.RESEND_API_KEY && from) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to: msg.to, cc: cc.length ? cc : undefined, reply_to: msg.replyTo ?? undefined, subject: msg.subject, html: msg.html, text: msg.text,
          attachments: attachments.map((f) => ({ filename: f.filename, content: f.content.toString('base64'), content_type: f.contentType })),
        }),
      })
      if (!r.ok) {
        const detail = (await r.json().catch(() => null)) as { message?: string } | null
        throw new Error(detail?.message ?? `Resend answered HTTP ${r.status}`)
      }
      return { ok: true, messageId: null, from }
    }
    if (env.SMTP_HOST && from) {
      const port = Number(env.SMTP_PORT || 465)
      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST, port, secure: port === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
      })
      const info = await transporter.sendMail({ from, to: msg.to, cc: cc.length ? cc : undefined, replyTo: msg.replyTo ?? undefined, subject: msg.subject, html: msg.html, text: msg.text, attachments })
      return { ok: true, messageId: (info.messageId as string | undefined) ?? null, from }
    }
    return { ok: false, error: "Email sending isn't set up yet. Connect your mailbox in Settings → My email, or download the PDF and send it yourself." }
  } catch (e) {
    return { ok: false, error: `The email could not be sent: ${e instanceof Error ? e.message : String(e)}` }
  }
}
