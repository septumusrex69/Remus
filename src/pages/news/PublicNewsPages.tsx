import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { brand, optInStep, signUp, unsubscribeStep, type OptInState, type UnsubscribeState } from '../../lib/newsApi'

/**
 * THE THREE NEWS PAGES OUTSIDE REMUS (Remus · Handover 8): nobody signs in, and the signed token in the address is
 * the whole of the authority. Raptor's UnsubscribePage and OptInPage (S10), adapted; the sign-up page is Remus's own
 * (Stephan asked for "sign-up"; Raptor has none). They carry the company's own logo from Settings, as quotes and
 * client emails do, and the skin's colours.
 *
 *   /unsubscribe/:token   the link in every newsletter
 *   /opt-in/:token        "Yes, keep me informed" (the invitation) and the sign-up's confirmation
 *   /subscribe            the public sign-up form
 */
function Shell({ children, testid }: { children: ReactNode; testid: string }) {
  const [co, setCo] = useState<{ name: string; logoUrl: string | null } | null>(null)
  useEffect(() => { brand().then(setCo).catch(() => setCo({ name: 'Urban Haus Construction', logoUrl: null })) }, [])
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" data-testid={testid}>
        {co?.logoUrl
          ? <img src={co.logoUrl} alt={co.name} className="mx-auto mb-5 max-h-14 w-auto object-contain" />
          : <p className="mb-5 text-xs tracking-wider text-slate-400 uppercase">{co?.name ?? ' '}</p>}
        {children}
      </div>
    </div>
  )
}

const BTN = 'rounded-lg bg-ink-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-ink-900 disabled:opacity-50'
const BTN2 = 'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50'

/**
 * THE UNSUBSCRIBE LINK (Raptor). OPENING THE PAGE IS THE UNSUBSCRIBE: POPIA wants stopping as easy as receiving,
 * and "are you sure?" is a second hurdle. A mistaken click is put right with one press, recorded as theirs.
 */
export function UnsubscribePage() {
  const { token = '' } = useParams()
  const [state, setState] = useState<UnsubscribeState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current || token === 'preview') return
    ran.current = true
    unsubscribeStep(token, 'unsubscribe').then(setState).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [token])
  async function resubscribe() {
    setBusy(true)
    try { setState(await unsubscribeStep(token, 'resubscribe')) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <Shell testid="unsubscribe-page">
      {token === 'preview' ? (
        <p className="text-slate-700">This is where the unsubscribe link in the newsletter leads.</p>
      ) : error ? (
        <p className="text-red-600" data-testid="unsubscribe-error">{error}</p>
      ) : !state ? (
        <p className="text-slate-500">One moment…</p>
      ) : state.status === 'subscribed' ? (
        <>
          <h1 className="mb-2 text-xl font-semibold text-slate-900" data-testid="unsubscribe-heading">You will receive our news again</h1>
          <p className="text-sm text-slate-600">{state.email} is back on our news list. Every email has a link to stop it again.</p>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-xl font-semibold text-slate-900" data-testid="unsubscribe-heading">You will not receive our news any more</h1>
          <p className="mb-1 text-sm text-slate-600">{state.email} has been taken off our news list.</p>
          <p className="mb-6 text-sm text-slate-500">Quotes, invoices and emails about your own job are not affected.</p>
          <button type="button" onClick={() => void resubscribe()} disabled={busy} className={BTN2} data-testid="unsubscribe-resubscribe">
            {busy ? 'One moment…' : 'That was a mistake: keep sending me news'}
          </button>
        </>
      )}
    </Shell>
  )
}

/**
 * "YES, KEEP ME INFORMED" (Raptor's OptInPage). OPENING THE PAGE RECORDS NOTHING; ONE MORE PRESS DOES: company mail
 * systems open every link to scan it, and POPIA consent has to be the person's own act. "That wasn't me" undoes it.
 */
export function OptInPage() {
  const { token = '' } = useParams()
  const [state, setState] = useState<OptInState | null>(null)
  const [withdrawn, setWithdrawn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current || token === 'preview') return
    ran.current = true
    optInStep(token, 'status').then(setState).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [token])
  async function step(s: 'yes' | 'withdraw') {
    setBusy(true)
    try { setState(await optInStep(token, s)); if (s === 'withdraw') setWithdrawn(true) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <Shell testid="opt-in-page">
      {token === 'preview' ? (
        <>
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Thank you: you’ll hear from us</h1>
          <p className="text-sm text-slate-600">This is the page the “Yes, keep me informed” button opens. Nothing has been recorded.</p>
        </>
      ) : error ? (
        <p className="text-red-600" data-testid="opt-in-error">{error}</p>
      ) : !state ? (
        <p className="text-slate-500">One moment…</p>
      ) : withdrawn ? (
        <>
          <h1 className="mb-2 text-xl font-semibold text-slate-900" data-testid="opt-in-heading">You will not hear from us</h1>
          <p className="text-sm text-slate-600">{state.email} has been taken off our news, and we will not write to it again.</p>
        </>
      ) : !state.optedIn ? (
        <>
          <h1 className="mb-2 text-xl font-semibold text-slate-900" data-testid="opt-in-heading">Keep {state.email} informed?</h1>
          <p className="mb-6 text-sm text-slate-600">Press below to confirm and we will send you our news: the jobs we finish and what we are working on. Every email has a link to stop it.</p>
          <button type="button" onClick={() => void step('yes')} disabled={busy} className={BTN} data-testid="opt-in-confirm">{busy ? 'One moment…' : 'Confirm: keep me informed'}</button>
        </>
      ) : (
        <>
          <h1 className="mb-2 text-xl font-semibold text-slate-900" data-testid="opt-in-heading">Thank you: you’ll hear from us</h1>
          <p className="mb-1 text-sm text-slate-600">We will send our news to {state.email}.</p>
          <p className="mb-6 text-sm text-slate-500">Every email has a link to stop it whenever you like.</p>
          <button type="button" onClick={() => void step('withdraw')} disabled={busy} className={BTN2} data-testid="opt-in-withdraw">
            {busy ? 'One moment…' : 'That wasn’t me: don’t send me anything'}
          </button>
        </>
      )}
    </Shell>
  )
}

/**
 * THE SIGN-UP PAGE (Remus's own). Name, email, a tick that says what they are asking for, and nothing is on the list
 * until they press the button in the confirmation email (double opt-in: a form anybody can type any address into is
 * not that person's consent). `website` is a box nobody sees; robots fill it in.
 */
export function SignUpPage() {
  const [form, setForm] = useState({ email: '', name: '', company: '', agree: false, website: '' })
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { setDone((await signUp(form)).message) } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  return (
    <Shell testid="sign-up-page">
      {done ? (
        <>
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Nearly there</h1>
          <p className="text-sm text-slate-600" data-testid="sign-up-done">{done}</p>
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-3 text-left">
          <h1 className="text-center text-xl font-semibold text-slate-900">Our news, by email</h1>
          <p className="text-center text-sm text-slate-600">The jobs we finish and what we are working on, now and then. Every email has a link to stop it.</p>
          <label className="block"><span className="label">Your name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" data-testid="sign-up-name" /></label>
          <label className="block"><span className="label">Email</span><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" data-testid="sign-up-email" /></label>
          <label className="block"><span className="label">Company (optional)</span><input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} autoComplete="organization" /></label>
          <label className="sr-only" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} data-testid="sign-up-agree" />
            <span>Yes, send me news by email. I can unsubscribe at any time.</span>
          </label>
          {error && <p className="text-sm text-red-600" data-testid="sign-up-error">{error}</p>}
          <button type="submit" disabled={busy || !form.agree || !form.email.trim()} className={`${BTN} w-full`} data-testid="sign-up-submit">{busy ? 'One moment…' : 'Sign me up'}</button>
          <p className="text-center text-xs text-slate-400">We will email you once to confirm. Your address is used for our news only.</p>
        </form>
      )}
    </Shell>
  )
}
