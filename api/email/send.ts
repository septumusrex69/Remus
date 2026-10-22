import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { adminClient, getConnection, logEmailActivity, sendFromOwnMailbox } from '../_lib/mailbox.js'

/**
 * Emails a client from the caller's own mailbox, with their signature, and files it on the
 * client's Emails card (Raptor's api/email/send). Body arrives as plain text and is escaped here.
 *
 * POST { to, subject, body, companyId?, contactId?, inReplyTo? }
 */

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
/** For ilike: an address containing _ or % must not match other addresses. */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const admin = adminClient()
  if (!admin) return res.status(501).json({ error: 'Email is not set up yet: add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.' })
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) return res.status(500).json({ error: keyProblem })
  const caller = await requireCaller(req)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })
  const { db } = caller

  const { data: me } = await db
    .from('profiles')
    .select('name, role, status, email_signature, email_signature_image_url, email_signature_image_width, email_signature_image_align')
    .eq('id', caller.user.id)
    .maybeSingle()
  if (!me || me.status !== 'Active' || me.role === 'Read Only') return res.status(403).json({ error: "Your access is read-only, so you can't send email." })

  const b = (req.body ?? {}) as Record<string, unknown>
  const to = typeof b.to === 'string' ? b.to.trim() : ''
  const subject = typeof b.subject === 'string' ? b.subject.trim().slice(0, 300) : ''
  const text = typeof b.body === 'string' ? b.body.trim().slice(0, 50000) : ''
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  if (!EMAIL_RE.test(to)) return res.status(400).json({ error: `"${to}" is not a valid email address.` })
  if (!subject || !text) return res.status(400).json({ error: 'A subject and a message are required.' })

  const conn = await getConnection(admin, caller.user.id)
  if (!conn) return res.status(400).json({ error: 'Connect your mailbox in Settings before sending email.' })

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>`
  let messageId: string | null
  try {
    messageId = await sendFromOwnMailbox(conn, me, { to: [to], cc: [], subject, html, text, attachments: [], inReplyTo: str(b.inReplyTo) })
  } catch (err) {
    return res.status(502).json({ error: `The email could not be sent: ${err instanceof Error ? err.message : String(err)}` })
  }

  // File it on the person it went to when the page didn't say (a company page emailing one of its
  // people), so it shows on that person's page as well as the company's.
  let contactId = str(b.contactId)
  let companyId = str(b.companyId)
  if (!contactId) {
    const { data: person } = await db.from('contacts').select('id, company_id').ilike('email', likeLiteral(to)).limit(1).maybeSingle()
    if (person) {
      contactId = person.id as string
      companyId = companyId ?? ((person.company_id as string | null) ?? null)
    }
  }
  const activityId = await logEmailActivity(db, { userId: caller.user.id, companyId, contactId, subject, notes: text, messageId })
  return res.status(200).json({ ok: true, messageId, activityId })
}
