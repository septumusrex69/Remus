import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, callerIsAdmin, requireCaller } from '../_lib/auth.js'

/** Whether the caller (or, for an admin, a targetUserId query param) has a connected mailbox. Never returns the password. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = adminClient()
  if (!admin) {
    res.status(500).json({ error: 'Email is not set up on the server: SUPABASE_SERVICE_ROLE_KEY is missing.' })
    return
  }
  const caller = await requireCaller(req)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const targetUserId = typeof req.query.targetUserId === 'string' ? req.query.targetUserId : undefined
  let userId = caller.user.id
  if (targetUserId && targetUserId !== userId) {
    if (!(await callerIsAdmin(admin, userId))) {
      res.status(403).json({ error: 'Only administrators can view another user’s mailbox status.' })
      return
    }
    userId = targetUserId
  }

  const { data: conn } = await admin.from('email_connections').select('email, last_synced_at').eq('user_id', userId).maybeSingle()
  res.status(200).json({ connected: !!conn, email: conn?.email ?? null, lastSyncedAt: conn?.last_synced_at ?? null })
}
