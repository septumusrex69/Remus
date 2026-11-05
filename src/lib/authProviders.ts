import { useEffect, useState } from 'react'
import { isSupabaseConfigured } from './supabase'

/**
 * SIGN IN WITH GOOGLE (Remus · Handover 8, 5 Nov 2026). Stephan, in the Supabase settings: "sign in with Google. I
 * think that's definitely what I want." NOT IN RAPTOR -- Raptor signs in with email and password only; this is
 * Remus's own, at Stephan's word.
 *
 * The button only shows once Google is switched on in Supabase (Authentication -> Sign In / Providers -> Google):
 * Supabase says which providers are on at /auth/v1/settings, which the sign-in page may read before anybody signs in.
 * A Google account only gets in if its email already belongs to someone invited to Remus: with "Allow new users to
 * sign up" off, Supabase refuses a Google account it does not know, and links one whose email it does.
 */
export function useGoogleSignIn(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const url = import.meta.env.VITE_SUPABASE_URL as string
    const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { external?: Record<string, boolean> } | null) => setOn(!!s?.external?.google))
      .catch(() => {})
  }, [])
  return on
}

/** Turns Supabase's answer for a Google account it would not let in into words. */
export function googleRefusal(message: string | null): string | null {
  if (!message) return null
  if (/signups? not allowed|signup.*disabled|not allowed for this instance/i.test(message)) {
    return 'That Google account is not on Remus yet. Ask your administrator to invite that email address, then try again.'
  }
  return message
}
