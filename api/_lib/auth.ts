import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { VercelRequest } from '@vercel/node'

/**
 * Remus functions act *as the caller*: the caller's Supabase JWT is verified, then a client
 * carrying that same JWT reads data, so row-level security applies exactly as in the browser.
 * No service-role key is needed (unlike Raptor's admin functions).
 */
export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export interface Caller {
  user: User
  /** Supabase client that runs every query as this user. */
  db: SupabaseClient
}

export async function requireCaller(req: VercelRequest): Promise<Caller | null> {
  const env = supabaseEnv()
  if (!env) return null
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  const db = createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  return { user: data.user, db }
}
