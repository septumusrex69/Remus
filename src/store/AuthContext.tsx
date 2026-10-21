import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured, authLinkType } from '../lib/supabase'
import type { Profile } from '../types'

/**
 * Same shape and behaviour as Raptor's AuthContext (session + the signed-in person's profile row,
 * with a retried profile fetch), trimmed to what Remus uses.
 */
interface AuthContextValue {
  session: Session | null
  currentUser: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  profileError: string | null
  reloadProfile: () => void
  /** Signed in from an invite or reset link and still has to choose a password. */
  needsPassword: boolean
  setPassword: (password: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [currentUser, setCurrentUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [needsPassword, setNeedsPassword] = useState(authLinkType !== null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true)
      setSession(newSession)
      if (!newSession) setCurrentUser(null)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id ?? null

  // Profile fetch, retried with a widening gap: the first read right after sign-in can lose a
  // race with the token being attached (see Raptor's AuthContext for the full story).
  useEffect(() => {
    if (!userId) return
    let active = true
    ;(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle<Profile>()
        if (!active) return
        if (data) {
          setCurrentUser(data)
          setProfileError(null)
          return
        }
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt))
        if (!active) return
      }
      setProfileError('We could not load your profile. Check your connection and try again.')
    })()
    return () => {
      active = false
    }
  }, [userId, reloadKey])

  async function signIn(email: string, password: string) {
    if (!isSupabaseConfigured) return { error: 'Supabase is not configured. Copy .env.example to .env.local.' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setNeedsPassword(false)
  }

  async function setPassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) setNeedsPassword(false)
    return { error: error?.message ?? null }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        currentUser,
        loading,
        signIn,
        signOut,
        needsPassword,
        setPassword,
        profileError,
        reloadProfile: () => {
          setProfileError(null)
          setReloadKey((k) => k + 1)
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
