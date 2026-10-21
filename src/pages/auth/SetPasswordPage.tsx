import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ArrowRight, Lock } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'

/** Landing page for invite and password-reset links: the person is signed in but has no password yet. */
export function SetPasswordPage() {
  const { session, loading, currentUser, setPassword, signOut } = useAuth()
  const navigate = useNavigate()
  const [password, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <div className="flex h-dvh items-center justify-center text-sm text-slate-400">Loading…</div>
  if (!session) return <Navigate to="/login" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError("The two passwords don't match.")
    setError(null)
    setSubmitting(true)
    const { error: err } = await setPassword(password)
    setSubmitting(false)
    if (err) setError(err)
    else navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <span className="text-xl font-semibold">Remus</span>
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Choose your password</h1>
        <p className="mt-1 text-sm text-slate-500">
          {currentUser?.email ?? session.user.email}: you'll use this with your email to sign in from now on.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="new-password" className="label">New password</label>
            <div className="relative">
              <Lock size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <input id="new-password" type="password" autoComplete="new-password" required className="input pl-9" value={password} onChange={(e) => setPw(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="confirm-password" className="label">Confirm password</label>
            <div className="relative">
              <Lock size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <input id="confirm-password" type="password" autoComplete="new-password" required className="input pl-9" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save and continue'} <ArrowRight size={16} />
          </button>
          <button type="button" onClick={() => signOut()} className="w-full text-center text-sm text-slate-500 hover:text-slate-700">
            Cancel and sign out
          </button>
        </form>
      </div>
    </div>
  )
}
