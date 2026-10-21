import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, Lock, Mail } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'

export function LoginPage() {
  const { session, loading, signIn, needsPassword } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && session && needsPassword) return <Navigate to="/set-password" replace />
  if (!loading && session) {
    const from = (location.state as { from?: { pathname: string } } | null)?.from
    return <Navigate to={from?.pathname ?? '/'} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: err } = await signIn(email, password)
    setSubmitting(false)
    if (err) setError(err)
  }

  async function handleReset() {
    if (!email) return setError('Enter your email first, then click "Forgot password?".')
    setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/set-password` })
    if (err) setError(err.message)
    else setInfo('Check your inbox for a reset link.')
  }

  return (
    <div className="flex min-h-dvh">
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-slate-900 p-10 text-white lg:flex">
        <img src="/brand/urban-haus-logo-white.png" alt="Urban Haus Construction" className="h-24 w-auto self-start object-contain" />
        <div>
          <h2 className="text-3xl font-semibold leading-tight">Quotes, projects, site diary and costs — in one place.</h2>
          <p className="mt-3 max-w-md text-slate-400">Know your margin on every job, from the first quote to the final payment.</p>
        </div>
        <p className="text-xs text-slate-500">Construction · Renovations · Maintenance · Electrical</p>
        <div className="pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-brand-500/10" />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <img src="/brand/urban-haus-logo.png" alt="Urban Haus Construction" className="mb-8 h-20 w-auto object-contain lg:hidden" />
          <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the email and password your administrator set up.</p>

          {!isSupabaseConfigured && (
            <div className="mt-5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
              Supabase isn't configured yet. Copy <code>.env.example</code> to <code>.env.local</code> and add your project URL and key.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <div className="relative">
                <Mail size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                <input id="email" type="email" autoComplete="email" required className="input pl-9" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.co.za" />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                <input id="password" type="password" autoComplete="current-password" required className="input pl-9" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="text-sm text-emerald-700">{info}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} />
            </button>
            <button type="button" onClick={handleReset} className="w-full text-center text-sm text-slate-500 hover:text-slate-700">
              Forgot password?
            </button>
          </form>
          <p className="mt-8 text-center text-xs text-slate-400">No account? Ask your administrator to invite you.</p>
        </div>
      </div>
    </div>
  )
}
