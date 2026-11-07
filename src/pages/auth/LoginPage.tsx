import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ArrowRight, Lock, Mail } from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { useTheme } from '../../store/ThemeContext'
import { photoUrl, rememberedLoginPhoto } from '../../lib/brandPhotos'
import { getDayPhoto } from '../../lib/api'
import { googleRefusal, useGoogleSignIn } from '../../lib/authProviders'
import { johannesburgToday, lookFromRow, type DayLook } from '../../lib/dayPhotos'
import { DAY_LOOK_FALLBACK_MS, rememberDay, rememberedDay } from '../../lib/dayLookCache'
import { queueRemusOpening } from '../../components/opening/openingQueue'
import { primeOpeningAudio } from '../../components/opening/remusSound'

export function LoginPage() {
  const { session, loading, signIn, needsPassword } = useAuth()
  const location = useLocation()
  const { theme } = useTheme()
  const remus = !!theme.tagline
  // The sign-in cannot read the settings: the photograph last chosen, remembered in this browser (lib/brandPhotos.ts).
  // Today's photo of the day, if approved (Remus · Handover 8): the sign-in may read approved days before anybody signs in.
  /*
   * NO FLASH OF YESTERDAY'S PHOTOGRAPH (Raptor S18, copied in Remus · Handover 8 -- lib/dayLookCache.ts): today's
   * answer as this device last read it, on the first paint; the first visit of the day shows the panel plain until the
   * answer is in (or four seconds have passed), instead of the last photograph and then today's.
   */
  const [seen] = useState(() => rememberedDay(johannesburgToday()))
  const [day, setDay] = useState<DayLook | null>(() => {
    const l = seen ? lookFromRow(seen.row, null, 'login') : null
    return l?.approved ? l : null
  })
  const [known, setKnown] = useState(() => !!seen || !isSupabaseConfigured)
  useEffect(() => {
    if (!theme.loginPhoto || !isSupabaseConfigured) return
    let live = true
    const today = johannesburgToday()
    const fallback = window.setTimeout(() => { if (live) setKnown(true) }, DAY_LOOK_FALLBACK_MS)
    getDayPhoto(today).then((r) => {
      if (!live) return
      rememberDay(today, r)
      const l = lookFromRow(r, null, 'login')
      setDay(l.approved ? l : null)
    }).catch(() => {}).finally(() => { if (live) { window.clearTimeout(fallback); setKnown(true) } })
    return () => { live = false; window.clearTimeout(fallback) }
  }, [theme.loginPhoto])
  const loginPhoto = theme.loginPhoto && known ? (day?.photo ?? rememberedLoginPhoto()) : null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const google = useGoogleSignIn()
  const [linking, setLinking] = useState(false)
  // Coming back from Google with a refusal (an account nobody invited), Supabase puts the reason in the address.
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.slice(1) || window.location.search)
    const why = p.get('error_description')
    if (why) setError(googleRefusal(why))
  }, [])

  if (!loading && session && needsPassword) return <Navigate to="/set-password" replace />
  if (!loading && session) {
    const from = (location.state as { from?: { pathname: string } } | null)?.from
    return <Navigate to={from?.pathname ?? '/'} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    // The password box is no longer `required` (the email link needs only the email), so Sign in asks for it here.
    if (!password) return setError('Enter your password, or tap "Email me a sign-in link".')
    setError(null)
    setSubmitting(true)
    /* The press is what lets the opening's sound play on an iPad, so the audio is woken here, inside it. */
    primeOpeningAudio()
    const { error: err } = await signIn(email, password)
    setSubmitting(false)
    if (err) setError(err)
    else queueRemusOpening()
  }

  async function handleGoogle() {
    setError(null)
    const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (err) setError(googleRefusal(err.message))
  }

  /*
   * EMAIL ME A SIGN-IN LINK (Remus · Handover 8, 5 Nov 2026). Stephan, for now instead of Google: "do the email link".
   * Not in Raptor. Supabase emails a link that signs the person in; `shouldCreateUser: false` so it only ever works
   * for someone already invited -- an unknown address gets the same calm answer and no account.
   */
  async function handleLink() {
    if (!email) return setError('Enter your email first, then tap "Email me a sign-in link".')
    setError(null)
    setInfo(null)
    setLinking(true)
    const { error: err } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } })
    setLinking(false)
    // One answer for known and unknown addresses alike, so the page does not tell a stranger who is on Remus.
    if (err && !/signups? not allowed|not found|otp_disabled/i.test(err.message)) setError(err.message)
    else setInfo(`If ${email} is on Remus, a sign-in link is on its way. Open it on this device.`)
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
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-ink-950 bg-cover bg-center p-10 text-white lg:flex"
        // Platinum (Remus · Handover 6): a construction photograph under black glass, graded so the words read.
        style={loginPhoto ? { backgroundImage: `linear-gradient(160deg, rgba(9,9,11,0.82) 0%, rgba(9,9,11,0.45) 55%, rgba(9,9,11,0.82) 100%), url('${photoUrl(loginPhoto, 1600)}')`, backgroundPosition: day ? `center, ${day.login.x}% ${day.login.y}%` : undefined } : undefined}>
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
          {day?.line && (
            <p className="mt-5 max-w-md text-sm text-white/75 italic" data-testid="login-day-line">
              “{day.line}”{day.who ? <span className="not-italic text-white/50"> — {day.who}</span> : null}
            </p>
          )}
        </div>
        <p className={remus ? 'skin-eyebrow text-[11px] text-white/40' : 'text-xs text-white/40'}>
          {remus ? 'Plans · People · Progress · Together' : 'Construction · Renovations · Maintenance · Electrical'}
        </p>
        {theme.loginPhoto
          ? (loginPhoto && <span className="absolute right-4 bottom-3 text-[10px] text-white/40">Photo: {loginPhoto.credit} / Unsplash</span>)
          : <div className="pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-brand-500/15" />}
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
                <input id="password" type="password" autoComplete="current-password" className="input pl-9" value={password} onChange={(e) => setPassword(e.target.value)} />
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
            <button type="button" onClick={() => void handleLink()} disabled={linking} data-testid="email-link"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60">
              <Mail size={15} /> {linking ? 'Sending…' : 'Email me a sign-in link'}
            </button>
            <button type="button" onClick={handleReset} className="w-full text-center text-sm text-slate-500 hover:text-slate-700">
              Forgot password?
            </button>
          </form>
          {/* Remus · Handover 8: Google, once it is switched on in Supabase (lib/authProviders.ts). */}
          {google && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
              <button type="button" onClick={() => void handleGoogle()} data-testid="google-sign-in"
                className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                <GoogleMark /> Continue with Google
              </button>
            </>
          )}
          <p className="mt-8 text-center text-xs text-slate-400">No account? Ask your administrator to invite you.</p>
        </div>
      </div>
    </div>
  )
}

/** Google's "G", in Google's own colours (its sign-in branding rules ask for them; not a Remus colour). */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
