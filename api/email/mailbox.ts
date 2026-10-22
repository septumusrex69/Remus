import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { credentialsKeyProblem, encrypt } from '../_lib/crypto.js'
import { adminClient, getConnection, imapClient, smtpTransport } from '../_lib/mailbox.js'

/**
 * The caller's own mailbox (adapted from Raptor's api/email/connect, status and disconnect, in one
 * function to stay well inside Vercel's function count).
 *
 * GET    → { connected, email }            never returns the password
 * POST   { email, password, smtpHost, smtpPort, imapHost, imapPort }
 *        → logs in over IMAP and SMTP first, and only saves when both work
 * DELETE → forgets the mailbox
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = adminClient()
  if (!admin) {
    return res.status(501).json({ error: 'Connecting mailboxes is not set up yet: add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.' })
  }
  const caller = await requireCaller(req)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })
  const userId = caller.user.id

  if (req.method === 'GET') {
    const conn = await getConnection(admin, userId)
    return res.status(200).json({ connected: !!conn, email: conn?.email ?? null })
  }

  if (req.method === 'DELETE') {
    const { error } = await admin.from('email_connections').delete().eq('user_id', userId)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { data: me } = await caller.db.from('profiles').select('status').eq('id', userId).maybeSingle()
  if (me?.status !== 'Active') return res.status(403).json({ error: 'Your account is deactivated.' })

  // Asked before the IMAP and SMTP checks: without the key the password can't be stored however
  // good it is, and a server problem must not read as though the mailbox were at fault.
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) return res.status(500).json({ error: `${keyProblem} Mailboxes can't be connected until it is set.` })

  const body = (req.body ?? {}) as Record<string, unknown>
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const smtpHost = typeof body.smtpHost === 'string' ? body.smtpHost.trim() : ''
  const imapHost = typeof body.imapHost === 'string' ? body.imapHost.trim() : ''
  const smtpPort = Number(body.smtpPort)
  const imapPort = Number(body.imapPort)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || !smtpHost || !imapHost || !smtpPort || !imapPort) {
    return res.status(400).json({ error: 'Email, password, and both SMTP and IMAP server and port are required.' })
  }

  // Check the details actually work before saving anything, so a typo fails here with a clear
  // message rather than later, in the middle of sending a quote.
  const conn = { email, smtp_host: smtpHost, smtp_port: smtpPort, imap_host: imapHost, imap_port: imapPort }
  try {
    const imap = imapClient(conn, password)
    await imap.connect()
    await imap.logout()
  } catch {
    return res.status(400).json({ error: "Couldn't log in to that mailbox over IMAP. Check the incoming server, port and password." })
  }
  try {
    await smtpTransport(conn, password).verify()
  } catch {
    return res.status(400).json({ error: "Couldn't log in to the outgoing (SMTP) server. Check the server, port and password." })
  }

  const { error } = await admin.from('email_connections').upsert({
    user_id: userId,
    ...conn,
    encrypted_password: encrypt(password),
    updated_at: new Date().toISOString(),
  })
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true, email })
}
