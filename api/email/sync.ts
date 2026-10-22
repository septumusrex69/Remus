import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, requireCaller } from '../_lib/auth.js'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { syncConnection, type EmailConnectionRow } from '../_lib/emailSync.js'

/** On-demand "Sync now" for the caller's own mailbox: the same logic the daily cron runs for everyone via sync-all. */
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

  const { data: conn } = await admin.from('email_connections').select('*').eq('user_id', caller.user.id).maybeSingle()
  if (!conn) {
    res.status(400).json({ error: 'Connect your mailbox in Settings first.' })
    return
  }

  try {
    const result = await syncConnection(admin, conn as EmailConnectionRow)
    res.status(200).json({ ok: true, logged: result.logged })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed.' })
  }
}
