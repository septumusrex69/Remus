import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { fetchAttachment } from '../_lib/emailSync.js'
import { adminClient, getConnection } from '../_lib/mailbox.js'

/**
 * Streams one attachment of a synced email straight out of the mailbox it arrived in, on demand
 * (Raptor's api/email/attachment). Nothing is copied into Storage: the mailbox is the archive.
 *
 * POST { activityId, filename }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const admin = adminClient()
  if (!admin) return res.status(501).json({ error: 'Email is not set up yet: add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.' })
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) return res.status(500).json({ error: keyProblem })
  const caller = await requireCaller(req)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })

  const { activityId, filename } = (req.body ?? {}) as { activityId?: string; filename?: string }
  if (!activityId || !filename) return res.status(400).json({ error: 'activityId and filename are required.' })

  // Read as the caller, so RLS decides whether they may see this email at all.
  const { data: activity } = await caller.db
    .from('activities')
    .select('id, user_id, email_message_id, email_folder, email_uid, attachment_names')
    .eq('id', activityId)
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
