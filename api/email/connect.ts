import type { VercelRequest, VercelResponse } from '@vercel/node'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import { adminClient, callerIsAdmin, requireCaller } from '../_lib/auth.js'
import { credentialsKeyProblem, encrypt } from '../_lib/crypto.js'

/** Verifies a mailbox's IMAP and SMTP login, then stores it (password encrypted). Same as Raptor's. */
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
  // Asked before the IMAP and SMTP checks, not after: without the key the password cannot be
  // stored however good it is, and a server problem must not read as a wrong password.
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) {
    res.status(500).json({ error: `${keyProblem} Mailboxes cannot be connected until it is set.` })
    return
  }
  const caller = await requireCaller(req)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { email, password, smtpHost, smtpPort, imapHost, imapPort, targetUserId } = (req.body ?? {}) as {
    email?: string
    password?: string
    smtpHost?: string
    smtpPort?: number
    imapHost?: string
    imapPort?: number
    targetUserId?: string
  }
  if (!email || !password || !smtpHost || !smtpPort || !imapHost || !imapPort) {
    res.status(400).json({ error: 'Email, password, and both SMTP and IMAP host/port are required.' })
    return
  }

  let userId = caller.user.id
  if (targetUserId && targetUserId !== userId) {
    if (!(await callerIsAdmin(admin, userId))) {
      res.status(403).json({ error: 'Only administrators can connect another user’s mailbox.' })
      return
    }
    userId = targetUserId
  }

  // Verify the credentials actually work before saving anything, so a typo fails here with a
  // clear message instead of silently breaking later at send or sync time.
  try {
    const imapClient = new ImapFlow({ host: imapHost, port: imapPort, secure: imapPort === 993, auth: { user: email, pass: password }, logger: false })
    await imapClient.connect()
    await imapClient.logout()
  } catch {
    res.status(400).json({ error: "Couldn't log in to that mailbox via IMAP — double check the host, port, and password." })
    return
  }

  try {
    const transporter = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user: email, pass: password } })
    await transporter.verify()
  } catch {
    res.status(400).json({ error: "Couldn't verify the SMTP server — double check the host, port, and password." })
    return
  }

  const { error } = await admin.from('email_connections').upsert({
    user_id: userId,
    email,
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    imap_host: imapHost,
    imap_port: imapPort,
    encrypted_password: encrypt(password),
    last_seen_uid: null,
    last_seen_uid_junk: null,
    updated_at: new Date().toISOString(),
  })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.status(200).json({ ok: true })
}
