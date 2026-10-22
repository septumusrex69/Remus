import type { VercelRequest, VercelResponse } from '@vercel/node'
import { adminClient, callerIsAdmin, requireCaller } from '../_lib/auth.js'

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
  const caller = await requireCaller(req)
  if (!caller) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return
  }

  const { targetUserId } = (req.body ?? {}) as { targetUserId?: string }
  let userId = caller.user.id
  if (targetUserId && targetUserId !== userId) {
    if (!(await callerIsAdmin(admin, userId))) {
      res.status(403).json({ error: 'Only administrators can disconnect another user’s mailbox.' })
      return
    }
    userId = targetUserId
  }

  await admin.from('email_connections').delete().eq('user_id', userId)
  res.status(200).json({ ok: true })
}
