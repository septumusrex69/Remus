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

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'missing-anon-key',
)

export const RECEIPTS_BUCKET = 'receipts'
export const QUOTE_FILES_BUCKET = 'quote-files'
