import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { fetchAttachments } from '../_lib/emailSync.js'
import { adminClient, getConnection, logEmailActivity, sendFromOwnMailbox } from '../_lib/mailbox.js'

/**
 * Emails a client from the caller's own mailbox, with their signature, and files it on the
 * client's Emails card (Raptor's api/email/send). Body arrives as plain text and is escaped here.
 *
 * POST { to, cc?, subject, body, companyId?, contactId?, inReplyTo?, forward? }
 *   `to` may hold several addresses separated by commas; `cc` is a list (Reply all).
 *   `forward: { mailId, names }`: A FORWARD KEEPS ITS FILES (Raptor H13, R-8: "When you forward an
 *   email it removes the attachment"). The files named, taken out of the caller's own mailbox here
 *   rather than uploaded by the browser (a phone would carry them twice, and Vercel refuses a request
 *   over 4.5 MB). Only names the sync recorded on that message; what does not fit under the ceiling
 *   or is no longer in the mailbox is left off and named back (`leftOff`), never dropped silently.
 */
const FORWARD_MAX_BYTES = 20 * 1024 * 1024

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
  const toList = (typeof b.to === 'string' ? b.to : '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)
  const cc = (Array.isArray(b.cc) ? b.cc : []).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
  const to = toList[0] ?? ''
  const subject = typeof b.subject === 'string' ? b.subject.trim().slice(0, 300) : ''
  const text = typeof b.body === 'string' ? b.body.trim().slice(0, 50000) : ''
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const bad = [...toList, ...cc].find((x) => !EMAIL_RE.test(x))
  if (!to || bad !== undefined) return res.status(400).json({ error: `"${bad ?? to}" is not a valid email address.` })
  if (toList.length + cc.length > 20) return res.status(400).json({ error: 'Too many recipients.' })
  if (!subject || !text) return res.status(400).json({ error: 'A subject and a message are required.' })

  const conn = await getConnection(admin, caller.user.id)
  if (!conn) return res.status(400).json({ error: 'Connect your mailbox in Settings before sending email.' })

  // The files of a forwarded message, read as the caller: RLS shows a mailbox row only to its owner.
  const attachments: { filename: string; content: Buffer; contentType?: string }[] = []
  const leftOff: string[] = []
  const fwd = b.forward as { mailId?: unknown; names?: unknown } | undefined
  const wanted = Array.isArray(fwd?.names) ? fwd.names.filter((x): x is string => typeof x === 'string') : []
  if (fwd && typeof fwd.mailId === 'string' && wanted.length) {
    const { data: mail } = await db.from('user_emails').select('folder, uid, message_id, attachment_names').eq('id', fwd.mailId).maybeSingle()
    const known = new Set(((mail?.attachment_names as string[] | null) ?? []))
    const names = wanted.filter((n) => known.has(n))
    leftOff.push(...wanted.filter((n) => !known.has(n)))
    if (mail && names.length) {
      let got: Awaited<ReturnType<typeof fetchAttachments>> = []
      try {
        got = await fetchAttachments(conn, { folder: mail.folder as string | null, uid: mail.uid as number | null, messageId: mail.message_id as string | null }, names)
      } catch {
        // The mailbox could not be read: every file is named as left off, and the words still go.
      }
      let total = 0
      for (const n of names) {
        const f = got.find((g) => g.filename === n)
        if (!f || total + f.content.length > FORWARD_MAX_BYTES) { leftOff.push(n); continue }
        total += f.content.length
        attachments.push({ filename: f.filename, content: f.content, contentType: f.contentType })
      }
    }
  }

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.5">${esc(text).replace(/\n/g, '<br>')}</div>`
  let messageId: string | null
  try {
    messageId = await sendFromOwnMailbox(conn, me, { to: toList, cc, subject, html, text, attachments, inReplyTo: str(b.inReplyTo) })
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
  return res.status(200).json({ ok: true, messageId, activityId, leftOff })
}
