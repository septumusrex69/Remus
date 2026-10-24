import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCaller } from '../_lib/auth.js'
import { credentialsKeyProblem } from '../_lib/crypto.js'
import { syncConnection, type EmailConnectionRow } from '../_lib/emailSync.js'
import { adminClient } from '../_lib/mailbox.js'
import { expireMailPictures } from '../_lib/mailPictures.js'

/**
 * Files new mail from known clients on their Emails card (Raptor's api/email/sync and sync-all,
 * in one function to stay inside Vercel's function count).
 *
 * POST, signed in       → syncs the caller's own mailbox ("Sync now")
 * GET, Bearer CRON_SECRET → syncs every connected mailbox (Vercel Cron, see vercel.json)
 */
/** Every refusal is logged, so "it isn't syncing" can be answered from the server log. */
function refuse(res: VercelResponse, status: number, error: string) {
  console.log(`[email/sync] refused ${status}: ${error}`)
  return res.status(status).json({ error })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[email/sync] ${req.method}`)
  const admin = adminClient()
  if (!admin) return refuse(res, 501, 'Email sync is not set up on this copy of Remus: SUPABASE_SERVICE_ROLE_KEY is missing. Use https://remus-xi.vercel.app.')
  const keyProblem = credentialsKeyProblem()
  if (keyProblem) return refuse(res, 500, keyProblem)

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
    // And the picture store's 30 days: a logo nobody has opened in a month is deleted. Never fails the sync.
    const pictureExpiry = await expireMailPictures(admin).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
    return res.status(200).json({ ok: true, results, pictureExpiry })
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const caller = await requireCaller(req)
  if (!caller) return refuse(res, 401, 'Please sign in again.')
  const { data: me } = await caller.db.from('profiles').select('status').eq('id', caller.user.id).maybeSingle()
  if (me?.status !== 'Active') return refuse(res, 403, 'Your account is deactivated.')

  const { data: conn } = await admin.from('email_connections').select('*').eq('user_id', caller.user.id).maybeSingle()
  if (!conn) return refuse(res, 400, 'Connect your mailbox in Settings first.')
  try {
    const r = await syncConnection(admin, conn as EmailConnectionRow)
    return res.status(200).json({ ok: true, logged: r.logged })
  } catch (err) {
    console.error('[email/sync] failed', err)
    return res.status(400).json({ error: err instanceof Error ? `Couldn't read your mailbox: ${err.message}` : 'Sync failed.' })
  }
}
