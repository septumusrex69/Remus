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
 * below consumes and clears that hash while it starts up, so read it first: the app then sends the
 * person to "Choose your password" instead of straight in. The user id comes from the token, so
 * the prompt only ever applies to that person's session, and it is remembered (localStorage) until
 * a password is set, in case they reload or close the tab first.
 */
const PENDING_PASSWORD_KEY = 'remus.pendingPasswordUser'

export const authLinkType: 'invite' | 'recovery' | null = (() => {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.hash.slice(1))
  const type = params.get('type')
  if (type !== 'invite' && type !== 'recovery') return null
  try {
    const payload = JSON.parse(atob((params.get('access_token') ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string }
    if (payload.sub) localStorage.setItem(PENDING_PASSWORD_KEY, payload.sub)
  } catch {
    // unreadable token or storage blocked: the PASSWORD_RECOVERY event still covers resets
  }
  return type
})()

/** The user id that still has to choose a password, if any. */
export function pendingPasswordUser(): string | null {
  try {
    return localStorage.getItem(PENDING_PASSWORD_KEY)
  } catch {
    return null
  }
}

export function setPendingPasswordUser(id: string | null): void {
  try {
    if (id) localStorage.setItem(PENDING_PASSWORD_KEY, id)
    else localStorage.removeItem(PENDING_PASSWORD_KEY)
  } catch {
    // storage blocked: nothing to remember
  }
}

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'missing-anon-key',
)

export const RECEIPTS_BUCKET = 'receipts'
export const QUOTE_FILES_BUCKET = 'quote-files'
export const BRANDING_BUCKET = 'branding'
