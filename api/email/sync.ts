import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { syncConnection, type EmailConnectionRow } from '../_lib/emailSync.js'
import { adminClient } from '../_lib/mailbox.js'

/**
 * Files new mail from known clients on their Emails card (Raptor's api/email/sync and sync-all,
 * in one function to stay inside Vercel's function count).
 *
 * POST, signed in       → syncs the caller's own mailbox ("Sync now")
 * GET, Bearer CRON_SECRET → syncs every connected mailbox (Vercel Cron, see vercel.json)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = adminClient()
  if (!admin) return res.status(501).json({ error: 'Email sync is not set up yet: add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.' })
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) return res.status(500).json({ error: keyProblem })

  const cronSecret = process.env.CRON_SECRET
  if (req.method === 'GET') {
    // Refused outright without CRON_SECRET, so nobody outside can set off a sync of every mailbox.
    if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })
    const { data: connections, error } = await admin.from('email_connections').select('*')
    if (error) return res.status(500).json({ error: error.message })
    const results: { userId: string; logged?: number; error?: string }[] = []
    for (const conn of (connections ?? []) as EmailConnectionRow[]) {
      try {
        const r = await syncConnection(admin, conn)
        results.push({ userId: conn.user_id, logged: r.logged })
      } catch (err) {
        results.push({ userId: conn.user_id, error: err instanceof Error ? err.message : 'Sync failed.' })
      }
    }
    return res.status(200).json({ ok: true, results })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const caller = await requireCaller(req)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })
  const { data: me } = await caller.db.from('profiles').select('status').eq('id', caller.user.id).maybeSingle()
  if (me?.status !== 'Active') return res.status(403).json({ error: 'Your account is deactivated.' })

  const { data: conn } = await admin.from('email_connections').select('*').eq('user_id', caller.user.id).maybeSingle()
  if (!conn) return res.status(400).json({ error: 'Connect your mailbox in Settings first.' })
  try {
    const r = await syncConnection(admin, conn as EmailConnectionRow)
    return res.status(200).json({ ok: true, logged: r.logged })
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? `Couldn't read your mailbox: ${err.message}` : 'Sync failed.' })
  }
}
