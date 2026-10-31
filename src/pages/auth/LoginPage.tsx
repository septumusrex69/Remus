import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, Lock, Mail } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { useTheme } from '../../store/ThemeContext'
import { queueRemusOpening } from '../../components/opening/openingQueue'
import { primeOpeningAudio } from '../../components/opening/remusSound'

export function LoginPage() {
  const { session, loading, signIn, needsPassword } = useAuth()
  const location = useLocation()
  const { theme } = useTheme()
  const remus = !!theme.tagline
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
    /* The press is what lets the opening's sound play on an iPad, so the audio is woken here, inside it. */
    primeOpeningAudio()
    const { error: err } = await signIn(email, password)
    setSubmitting(false)
    if (err) setError(err)
    else queueRemusOpening()
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
      {theme.loginArt ? (
        // The brand artwork: the wordmark on a floorplan, with the board's line under it.
        <div className="relative hidden w-1/2 flex-col justify-end overflow-hidden border-r border-slate-200 bg-[#fcf8ef] p-10 lg:flex">
          <img
            src={theme.loginArt}
            alt={theme.productName}
            className="absolute inset-x-0 top-1/2 w-full -translate-y-[62%] object-contain"
            // Feathered on all four sides so the drawing fades into the paper instead of ending in a box.
            style={{
              maskImage: 'linear-gradient(to right, transparent, #000 12%, #000 88%, transparent), linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent)',
              maskComposite: 'intersect',
              WebkitMaskImage: 'linear-gradient(to right, transparent, #000 12%, #000 88%, transparent), linear-gradient(to bottom, transparent, #000 18%, #000 82%, transparent)',
              WebkitMaskComposite: 'source-in',
            }}
          />
          <div className="relative">
            <p className="skin-eyebrow text-[11px] font-medium text-slate-500">Construction management</p>
            <h2 className="mt-2 text-3xl font-light text-slate-800">Build with clarity.</h2>
            <p className="mt-2 max-w-md text-sm text-slate-500">Quotes, projects, site diary and costs in one place, for Urban Haus Construction.</p>
            <p className="skin-eyebrow mt-6 text-[10.5px] text-slate-400">Plans · People · Progress · Together</p>
          </div>
        </div>
      ) : (
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-ink-950 p-10 text-white lg:flex">
        {remus ? (
          <div className="self-start">
            <img src={theme.lockupLight} alt={theme.productName} className="h-12 w-auto object-contain" />
            <p className="skin-eyebrow mt-3 text-[11px] font-medium text-white/60">Construction management</p>
          </div>
        ) : (
          <img src={theme.lockupLight} alt="Urban Haus Construction" className="h-24 w-auto self-start object-contain" />
        )}
        <div>
          <h2 className="text-3xl font-semibold leading-tight">{remus ? 'Build with clarity.' : 'Quotes, projects, site diary and costs — in one place.'}</h2>
          <p className="mt-3 max-w-md text-white/55">
            {remus
              ? 'Quotes, projects, site diary and costs in one place, for Urban Haus Construction.'
              : 'Know your margin on every job, from the first quote to the final payment.'}
          </p>
        </div>
        <p className={remus ? 'skin-eyebrow text-[11px] text-white/40' : 'text-xs text-white/40'}>
          {remus ? 'Plans · People · Progress · Together' : 'Construction · Renovations · Maintenance · Electrical'}
        </p>
        <div className="pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-brand-500/15" />
      </div>
      )}

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <img src={theme.lockupDark} alt={theme.productName} className={remus ? "mb-8 h-9 w-auto object-contain lg:hidden" : "mb-8 h-20 w-auto object-contain lg:hidden"} />
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
