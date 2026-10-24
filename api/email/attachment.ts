import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { fetchAttachment, fetchMessageHtml } from '../_lib/emailSync.js'
import { adminClient, getConnection } from '../_lib/mailbox.js'
import { extractPictures, savePictures } from '../_lib/mailPictures.js'

/**
 * Streams one attachment of a synced email straight out of the mailbox it arrived in, on demand
 * (Raptor's api/email/attachment). Nothing is copied into Storage: the mailbox is the archive.
 *
 * POST { activityId, filename }   an email on a client's Emails card
 * POST { mailId, filename }       a message in the caller's own mailbox (the Mail page)
 * POST { mailId, pictures: true }  that message's markup WITH its pictures. The stored copy leaves
 *                                  them out (they were ~320 kB a message); the Mail page shows the
 *                                  words at once and asks for this to fill the pictures in.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const admin = adminClient()
  if (!admin) return res.status(501).json({ error: 'Email is not set up yet: add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.' })
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) return res.status(500).json({ error: keyProblem })
  const caller = await requireCaller(req)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })

  const { activityId, mailId, filename } = (req.body ?? {}) as { activityId?: string; mailId?: string; filename?: string }

  if (mailId && (req.body as { pictures?: boolean }).pictures === true) {
    // Read as the caller: RLS shows a mailbox row only to its owner, so this is your own mail.
    const { data: mail } = await caller.db
      .from('user_emails').select('id, user_id, folder, uid, message_id').eq('id', mailId).maybeSingle()
    if (!mail) return res.status(404).json({ error: 'That email is no longer in Remus.' })
    const own = await getConnection(admin, mail.user_id as string)
    if (!own) return res.status(400).json({ error: 'Your mailbox is no longer connected.' })
    try {
      const html = await fetchMessageHtml(own, {
        folder: mail.folder as string | null, uid: mail.uid as number | null, messageId: mail.message_id as string | null,
      })
      if (html === null) return res.status(404).json({ error: 'Could not find that message in the mailbox.' })
      /*
       * AND SAVED, so this is the last time this email's pictures cost a mailbox trip: they go into
       * the picture store and the stored copy is rewritten to name them by fingerprint. This is
       * what heals an email whose pictures were never saved, or were deleted after 30 days unused.
       */
      const { html: kept, pictures } = extractPictures(html)
      if (pictures.length > 0) {
        await savePictures(admin, pictures).catch(() => 0)
        await admin.from('user_emails').update({ body_html: kept }).eq('id', mail.id).not('body_html', 'is', null)
      }
      return res.status(200).json({ html })
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : 'Could not reach the mailbox.' })
    }
  }
  if ((!activityId && !mailId) || !filename) return res.status(400).json({ error: 'activityId or mailId, and filename, are required.' })

  // Read as the caller, so RLS decides whether they may see this email at all (a mailbox row is
  // only ever visible to its owner).
  const { data: activity } = activityId
    ? await caller.db
        .from('activities')
        .select('id, user_id, email_message_id, email_folder, email_uid, attachment_names')
        .eq('id', activityId)
        .maybeSingle()
    : await caller.db
        .from('user_emails')
        .select('id, user_id, email_message_id:message_id, email_folder:folder, email_uid:uid, attachment_names')
        .eq('id', mailId!)
        .maybeSingle()
  if (!activity) return res.status(404).json({ error: 'That email is no longer in Remus.' })
  // Only names the sync recorded on this email, so this can't pull arbitrary files out of a mailbox.
  if (!((activity.attachment_names as string[] | null) ?? []).includes(filename)) {
    return res.status(404).json({ error: 'That file is not attached to this email.' })
  }

  // The mailbox is whoever received the mail, not necessarily the caller: a colleague opening a
  // client's file is expected.
  const conn = await getConnection(admin, activity.user_id as string)
  if (!conn) return res.status(400).json({ error: 'The mailbox this email arrived in is no longer connected.' })

  try {
    const file = await fetchAttachment(
      conn,
      { folder: activity.email_folder as string | null, uid: activity.email_uid as number | null, messageId: activity.email_message_id as string | null },
      filename,
    )
    if (!file) return res.status(404).json({ error: 'Could not find that attachment. The email may have been moved or deleted from the mailbox.' })
    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`)
    return res.status(200).send(file.content)
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Could not reach the mailbox.' })
  }
}
