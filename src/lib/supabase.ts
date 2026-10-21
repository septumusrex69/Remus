import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
// Same variable as Raptor (VITE_SUPABASE_ANON_KEY). The newer "publishable" key works in it too;
// VITE_SUPABASE_PUBLISHABLE_KEY is accepted as an alias.
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as
  | string
  | undefined

/**
 * False when the env vars are missing. Raptor throws at import time; Remus instead lets the
 * login page render and explain what to do, so a fresh clone shows something useful.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

/**
 * Invite and password-reset links arrive as `#access_token=…&type=invite|recovery`. The client
 * below consumes and clears that hash while it starts up, so read the type first: the app then
 * sends the person to "Set your password" instead of straight in.
 */
export const authLinkType: 'invite' | 'recovery' | null = (() => {
  if (typeof window === 'undefined') return null
  const type = new URLSearchParams(window.location.hash.slice(1)).get('type')
  return type === 'invite' || type === 'recovery' ? type : null
})()

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'missing-anon-key',
)

export const RECEIPTS_BUCKET = 'receipts'
export const QUOTE_FILES_BUCKET = 'quote-files'
export const BRANDING_BUCKET = 'branding'
