import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, currentUser, profileError, reloadProfile, signOut, needsPassword } = useAuth()
  const location = useLocation()
  if (loading) return <div className="flex h-dvh items-center justify-center text-sm text-slate-400">Loading…</div>
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />
  if (needsPassword) return <Navigate to="/set-password" replace />
  if (currentUser?.status === 'Inactive') {
    return (
      <div className="flex h-dvh items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <p className="mb-1 font-semibold text-slate-900">Your access has been removed</p>
          <p className="mb-4 text-sm text-slate-500">Ask an administrator to reactivate your account.</p>
          <button onClick={() => signOut()} className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white">Sign out</button>
        </div>
      </div>
    )
  }
  if (profileError) {
    return (
      <div className="flex h-dvh items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <p className="mb-1 font-semibold text-slate-900">We couldn't load your profile</p>
          <p className="mb-4 text-sm text-slate-500">{profileError}</p>
          <div className="flex justify-center gap-2">
            <button onClick={reloadProfile} className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white">Try again</button>
            <button onClick={() => signOut()} className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">Sign out</button>
          </div>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
