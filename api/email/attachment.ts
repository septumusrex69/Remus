import type { VercelRequest, VercelResponse } from '@vercel/node'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { fetchAttachment } from '../_lib/emailSync.js'

/**
 * Streams one attachment out of the connected mailbox on demand. Nothing is stored: the mailbox
 * stays the archive, and Remus reaches into it when someone actually wants a file.
 */
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

  const { activityId, filename } = (req.body ?? {}) as { activityId?: string; filename?: string }
  if (!activityId || !filename) {
    res.status(400).json({ error: 'activityId and filename are required.' })
    return
  }

  const { data: activity } = await admin
    .from('activities')
    .select('id, user_id, email_message_id, email_folder, email_uid, attachment_names')
    .eq('id', activityId)
    .maybeSingle()
  if (!activity) {
    res.status(404).json({ error: 'That email is no longer in Remus.' })
    return
  }
  // Only serve names the sync actually recorded on this email, so this can't be used to pull
  // arbitrary files out of the mailbox by guessing names.
  if (!((activity.attachment_names as string[] | null) ?? []).includes(filename)) {
    res.status(404).json({ error: 'That file is not attached to this email.' })
    return
  }

  // The mailbox belongs to whoever received the mail, not to the caller: a colleague opening a
  // client's file is expected (everyone in Remus sees every client).
  const { data: conn } = await admin.from('email_connections').select('*').eq('user_id', activity.user_id).maybeSingle()
  if (!conn) {
    res.status(400).json({ error: 'The mailbox this email came from is no longer connected.' })
    return
  }

  try {
    const file = await fetchAttachment(
      conn as { email: string; imap_host: string; imap_port: number; encrypted_password: string },
      { folder: activity.email_folder as string | null, uid: activity.email_uid as number | null, messageId: activity.email_message_id as string | null },
      filename,
    )
    if (!file) {
      res.status(404).json({ error: 'Could not find that attachment — the original email may have been moved or deleted from the mailbox.' })
      return
    }
    res.setHeader('Content-Type', file.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`)
    res.status(200).send(file.content)
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Could not reach the mailbox.' })
  }
}
