import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { accessOf, type Access } from '../lib/access'
import { useAuth } from '../store/AuthContext'
import type { Profile } from '../types'

/**
 * A page only some may open (lib/access.ts). Anyone else lands on the dashboard rather than a page of
 * blanks -- or `otherwise`, e.g. a quote's print view for a contractor.
 *
 * Nothing is decided until the signed-in person's profile has loaded: on a fresh load it arrives a
 * moment after the session, and deciding before it would send an Administrator away from Finance.
 */
export function Allow({ when, otherwise, children }: { when: (a: Access, p: Profile) => boolean; otherwise?: string; children: ReactNode }) {
  const { currentUser } = useAuth()
  if (!currentUser) return null
  return when(accessOf(currentUser), currentUser) ? <>{children}</> : <Navigate to={otherwise ?? '/'} replace />
}
