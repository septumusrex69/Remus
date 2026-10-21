import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { requireCaller } from '../_lib/auth.js'

/**
 * Sends a Supabase invite email (adapted from Raptor's api/invite-user.ts). Inviting needs
 * Supabase's admin API and so the service-role key, which only ever lives here on the server.
 * The caller must be an active Administrator, checked against their own profile row.
 */
const ROLES = ['Administrator', 'Sales Representative', 'Read Only'] as const

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return res.status(501).json({
      error: 'Inviting from Remus is not set up yet: add SUPABASE_SERVICE_ROLE_KEY to the Vercel project. You can still invite people from the Supabase dashboard.',
    })
  }

  const caller = await requireCaller(req)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })
  const { data: me } = await caller.db.from('profiles').select('role, status').eq('id', caller.user.id).maybeSingle()
  if (me?.role !== 'Administrator' || me.status !== 'Active') {
    return res.status(403).json({ error: 'Only administrators can invite people.' })
  }

  const { email, name, role } = (req.body ?? {}) as { email?: unknown; name?: unknown; role?: unknown }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Enter a valid email address.' })
  }
  if (role !== undefined && !ROLES.includes(role as (typeof ROLES)[number])) {
    return res.status(400).json({ error: 'Invalid role.' })
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  // Fixed production URL rather than the request's Origin, so the link always opens the real app.
  const appUrl = (process.env.APP_URL || 'https://remus-xi.vercel.app').replace(/\/$/, '')
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email.trim(), {
    redirectTo: `${appUrl}/set-password`,
    ...(typeof name === 'string' && name.trim() ? { data: { name: name.trim() } } : {}),
  })
  if (error) return res.status(400).json({ error: error.message })

  // handle_new_user() already created the profile with the default role; apply the chosen one.
  // This runs as the inviting admin, not the service role: protect_profile_privileged_fields only
  // lets an Administrator's own session change a role, and silently keeps the old one otherwise.
  if (data.user?.id && role && role !== 'Sales Representative') {
    const { data: rows, error: roleErr } = await caller.db.from('profiles').update({ role }).eq('id', data.user.id).select('role')
    if (roleErr || rows?.[0]?.role !== role) {
      return res.status(500).json({ error: `Invite sent, but their access could not be set to ${role}. Change it in the team list.` })
    }
  }
  return res.status(200).json({ ok: true, userId: data.user?.id ?? null })
}
