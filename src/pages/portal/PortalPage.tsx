import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight, CalendarDays, Camera, Check, Download, Eye, EyeOff, FileText, HardHat, Headphones, KeyRound, Lock, Mail, MapPin,
  NotebookPen, Receipt, X,
} from 'lucide-react'
import { clsx } from 'clsx'
import { formatDate, formatDateTime, formatZAR } from '../../lib/format'
import { PORTAL_PASSWORD_MIN, portalPasswordProblem } from '../../lib/portalPassword'
import {
  PortalSignedOut, acceptPortalQuote, fetchPortalBrand, fetchPortalMe, fetchPortalOverview, fetchPortalQuotePdf, portalSignInWithPassword,
  portalSignOut, portalToken, requestPortalCode, savePortalToken, setPortalPassword, verifyPortalCode,
  type PortalBrand, type PortalMe, type PortalOverview, type PortalProject, type PortalQuote, type PortalStageState,
} from '../../lib/portalApi'

/**
 * THE CLIENT PORTAL (Remus · Handoff 5, Raptor H13's PortalPage) -- outside the app: no staff login, no
 * staff navigation. A client signs in and follows their job.
 *
 * Stephan: "To see their progresses and things." Phase 1: each project and where its stages stand on
 * the plan, the quotes sent to them, and their invoices with what is paid. Part 2 (Remus · Handover 8,
 * Stephan: "Yeah, you can continue with the client. Login as well. The Raptor stuff, you can build in."):
 * site photos and progress notes the office ticked for the client, the quote as its PDF, and accepting a
 * quote here. The company's own name and logo from Settings (a client-facing page, like a quote), with the
 * skin's colours.
 */
export default function PortalPage() {
  const [token, setToken] = useState<string | null>(() => portalToken())
  const [me, setMe] = useState<PortalMe | null>(null)

  const signedOut = useCallback(() => { savePortalToken(null); setToken(null); setMe(null) }, [])

  useEffect(() => {
    if (!token) return
    let live = true
    fetchPortalMe(token).then((m) => { if (live) setMe(m) }).catch(() => { if (live) signedOut() })
    return () => { live = false }
  }, [token, signedOut])

  if (!token) return <SignIn onSignedIn={(t, remember) => { savePortalToken(t, remember); setToken(t) }} />

  return (
    <div className="min-h-dvh overflow-x-hidden bg-slate-50" data-testid="portal-page">
      <header className="bg-ink-950 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {me?.company.logoUrl && <img src={me.company.logoUrl} alt="" className="h-10 max-w-28 shrink-0 rounded bg-white object-contain p-1" />}
            <div className="min-w-0">
              <p className="truncate text-[11px] tracking-wider text-white/60 uppercase">{me?.company.name ?? 'Client portal'}</p>
              <p className="truncate text-lg leading-tight font-semibold">{me ? me.client : 'Your building work'}</p>
            </div>
          </div>
          {me && (
            <div className="shrink-0 text-right text-sm">
              <p className="max-w-32 truncate text-white/80 sm:max-w-40">{me.name || me.email}</p>
              <button type="button" className="text-xs text-white/60 underline" onClick={() => { portalSignOut(token).catch(() => {}); signedOut() }}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {!me ? <p className="text-sm text-slate-400">Opening your projects…</p>
          : <Overview token={token} me={me} onSignedOut={signedOut} />}
      </main>
    </div>
  )
}

/* ------------------------------------------------------------------ signing in */

/*
 * SIGNING IN: THE ADDRESS AND A PASSWORD (Remus · Handover 8, copied from Raptor S16's PortalPage SignIn).
 * The emailed code is the way in only the first time and when the password is forgotten -- and either way it
 * ends by choosing a password, so the next visit needs no email.
 *
 * Raptor's layout: a split screen -- the firm's side on the left with its mark and the promise over a rule, the
 * door on the right: "Secure client portal", fields with their icons, a way to see the password, Keep me signed
 * in, Forgot your password, and a way to reach the firm. On a phone the left becomes a band across the top.
 * DIFFERENT FROM RAPTOR: Remus's colours come from the skin (ink-950 where Raptor has navy, brand where it has
 * gold), and the mark is the company's own logo from Settings, as on the rest of the portal and on a quote --
 * Raptor's coastline photograph and Raleway/Open Sans are Bredell Ferreira's, not Urban Haus's.
 */
type Step = 'password' | 'email' | 'code' | 'set'

/* An input with its icon. Out here, not inside SignIn: a component defined in a render is a new component every
   render, and React would rebuild the input under the client's fingers on every keystroke (Raptor's note). */
function Field({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400">{icon}</span>
      {children}
    </div>
  )
}

function SignIn({ onSignedIn }: { onSignedIn: (token: string, remember: boolean) => void }) {
  const [brand, setBrand] = useState<PortalBrand | null>(null)
  const [step, setStep] = useState<Step>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  /* The session the code opened, held until the new password is saved: a client who walks away at that step
     has not been left signed in without one. */
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { fetchPortalBrand().then(setBrand).catch(() => {}) }, [])

  const run = async (f: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await f() } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  const signIn = (e: FormEvent) => { e.preventDefault(); void run(async () => onSignedIn((await portalSignInWithPassword(email, password, remember)).token, remember)) }
  const send = (e?: FormEvent) => { e?.preventDefault(); void run(async () => { setSent((await requestPortalCode(email)).message); setStep('code') }) }
  const check = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      /* Always asked for a password after a code: the code is the first visit or the reset. */
      const r = await verifyPortalCode(email, code, true, remember)
      if (r.needsPassword) { setPending(r.token); setPassword(''); setAgain(''); setStep('set') } else onSignedIn(r.token, remember)
    })
  }
  const save = (e: FormEvent) => {
    e.preventDefault()
    if (password !== again) { setError('The two passwords are not the same.'); return }
    const problem = portalPasswordProblem(password, email)
    if (problem) { setError(problem); return }
    void run(async () => { await setPortalPassword(pending!, password); onSignedIn(pending!, remember) })
  }
  const go = (s: Step) => { setStep(s); setError(null); setCode(''); if (s !== 'set') setAgain('') }

  const company = brand?.name ?? 'Urban Haus Construction'
  const field = 'input w-full py-2.5 pl-10 text-[15px]'
  const primary = 'flex w-full items-center justify-center gap-2 rounded-lg bg-ink-950 py-3 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60'
  const link = 'font-medium underline-offset-4 hover:underline'
  const secret = (value: string, set: (v: string) => void, placeholder: string, testId: string, auto: string) => (
    <Field icon={<Lock size={17} />}>
      <input type={showPassword ? 'text' : 'password'} required autoComplete={auto} value={value} onChange={(e) => set(e.target.value)}
        placeholder={placeholder} className={`${field} pr-11`} data-testid={testId} />
      <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide the password' : 'Show the password'}
        aria-pressed={showPassword} data-testid={`${testId}-show`}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </Field>
  )
  const help = brand?.email
    ? `mailto:${brand.email}?subject=${encodeURIComponent('Client portal sign-in')}`
    : brand?.phone ? `tel:${brand.phone.replace(/\s/g, '')}` : null

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-slate-50 lg:flex-row" data-testid="portal-page">
      {/* LEFT (a band on a phone): THE COMPANY, AND THE PROMISE. */}
      <div className="relative flex flex-col justify-between gap-8 overflow-hidden bg-ink-950 p-6 text-white sm:p-10 lg:w-[56%] lg:p-14">
        <div className="pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full border border-brand-500/30" />
        <div className="pointer-events-none absolute -right-10 -bottom-10 h-52 w-52 rounded-full border border-brand-500/20" />
        <div className="relative flex min-w-0 items-center gap-3" data-testid="portal-sign-in-logo">
          {brand?.logoUrl
            ? <img src={brand.logoUrl} alt={company} className="h-12 max-w-40 shrink-0 rounded bg-white object-contain p-1.5 sm:h-14" />
            : <span className="truncate text-sm font-semibold tracking-[0.2em] uppercase">{company}</span>}
        </div>
        <div className="relative max-w-xl">
          <p className="skin-eyebrow text-[11px] font-semibold tracking-[0.24em] text-brand-300 uppercase">Client portal</p>
          <h2 className="mt-3 text-[26px] leading-tight font-semibold sm:text-4xl lg:text-[44px]">
            Your building work, where it stands, whenever you want to look.
          </h2>
          <div className="mt-5 h-[2px] w-16 rounded bg-brand-500" />
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/75">
            Each stage of your project, photos from site, your quotes and your invoices — all in one place.
          </p>
        </div>
      </div>

      {/* RIGHT: THE DOOR. */}
      <div className="flex flex-1 flex-col px-5 py-8 sm:px-12 lg:py-12">
        <p className="flex items-center justify-end gap-2 text-[10.5px] font-semibold tracking-[0.22em] text-slate-500 uppercase">
          <Lock size={13} /> Secure client portal
        </p>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-8" data-testid="portal-sign-in">
          <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">{step === 'set' ? 'Choose a password' : 'Sign in'}</h1>
          <p className="mt-2 mb-7 text-[15px] leading-relaxed text-slate-600">
            {step === 'password' && `Follow your project with ${company}.`}
            {step === 'email' && 'First time here, or forgot your password? We email you a code, then you choose a password.'}
            {step === 'code' && <span data-testid="portal-code-sent">{sent}</span>}
            {step === 'set' && `From now on you sign in with ${email} and this password. At least ${PORTAL_PASSWORD_MIN} characters; a short phrase is easiest to remember.`}
          </p>

          {step === 'password' && (
            <form onSubmit={signIn} className="space-y-4">
              <Field icon={<Mail size={17} />}>
                <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.co.za" className={field} data-testid="portal-email" />
              </Field>
              {secret(password, setPassword, 'Password', 'portal-password', 'current-password')}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-slate-700">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="portal-remember"
                    className="h-4 w-4 rounded border-slate-300 accent-ink-950" />
                  Keep me signed in
                </label>
                <button type="button" onClick={() => go('email')} className={`${link} text-slate-600 underline`} data-testid="portal-forgot">
                  Forgot your password?
                </button>
              </div>
              <button type="submit" disabled={busy || !email || !password} className={`${primary} mt-2`} data-testid="portal-sign-in-button">
                Sign in <ArrowRight size={17} />
              </button>
              <p className="pt-1 text-center text-sm text-slate-600">
                First time here?{' '}
                <button type="button" onClick={() => go('email')} className={`${link} text-slate-900`} data-testid="portal-use-code">Email me a sign-in code</button>
              </p>
            </form>
          )}
          {step === 'email' && (
            <form onSubmit={send} className="space-y-4">
              <Field icon={<Mail size={17} />}>
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.co.za" className={field} data-testid="portal-email" />
              </Field>
              <button type="submit" disabled={busy || !email} className={primary}>Email me a code</button>
              <button type="button" onClick={() => go('password')} className={`w-full text-sm text-slate-600 ${link}`}>I have a password</button>
            </form>
          )}
          {step === 'code' && (
            <form onSubmit={check} className="space-y-4">
              <Field icon={<KeyRound size={17} />}>
                <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder="123 456" className={`${field} text-lg tracking-[0.3em]`} data-testid="portal-code" />
              </Field>
              <button type="submit" disabled={busy || !code} className={primary}>Continue</button>
              <div className="flex justify-between gap-3 text-sm text-slate-600">
                <button type="button" className={link} onClick={() => go('email')}>Use another address</button>
                <button type="button" className={link} disabled={busy} onClick={() => send()}>Send a new code</button>
              </div>
            </form>
          )}
          {step === 'set' && (
            <form onSubmit={save} className="space-y-4">
              {secret(password, setPassword, 'New password', 'portal-new-password', 'new-password')}
              {secret(again, setAgain, 'The same again', 'portal-new-password-again', 'new-password')}
              <button type="submit" disabled={busy || !password || !again} className={primary} data-testid="portal-save-password">
                Save and sign in <ArrowRight size={17} />
              </button>
            </form>
          )}
          {error && <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="portal-error">{error}</p>}
        </div>

        {help && (
          <a href={help} className="group mx-auto flex w-full max-w-[420px] items-center gap-4" data-testid="portal-support">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><Headphones size={19} /></span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-slate-900">Need help signing in?</span>
              <span className="flex items-center gap-1.5 text-sm text-slate-600 group-hover:underline">Contact {company} <ArrowRight size={14} /></span>
            </span>
          </a>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ signed in */

function Overview({ token, me, onSignedOut }: { token: string; me: PortalMe; onSignedOut: () => void }) {
  const [data, setData] = useState<PortalOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)

  useEffect(() => {
    let live = true
    fetchPortalOverview(token)
      .then((d) => { if (live) setData(d) })
      .catch((e: Error) => { if (!live) return; if (e instanceof PortalSignedOut) onSignedOut(); else setError(e.message) })
    return () => { live = false }
  }, [token, onSignedOut, n])

  if (error) return <p className="text-sm text-red-700">{error}</p>
  if (!data) return <p className="text-sm text-slate-400">Reading…</p>

  const owing = data.invoices.reduce((s, i) => s + i.owing, 0)
  const paid = data.invoices.reduce((s, i) => s + i.paid, 0)
  const first = me.name.trim().split(' ')[0]

  return (
    <div className="space-y-6">
      <p className="text-slate-600">{first ? `Hi ${first}. ` : ''}Here is where your building work with {me.company.name} stands today, {formatDate(data.today)}.</p>

      <Section icon={<HardHat size={16} />} title="Your projects">
        {data.projects.length === 0
          ? <Empty>No project has started yet. Once a quote is accepted and the work is planned, it shows here.</Empty>
          : <div className="space-y-4">{data.projects.map((p) => <ProjectCard key={p.id} p={p} />)}</div>}
      </Section>

      <Section icon={<FileText size={16} />} title="Quotes">
        {data.quotes.length === 0 ? <Empty>No quotes yet.</Empty> : (
          <ul className="card divide-y divide-slate-100 overflow-hidden" data-testid="portal-quotes">
            {data.quotes.map((q) => (
              <QuoteRow key={q.id} q={q} token={token} me={me} onSignedOut={onSignedOut} onAccepted={() => setN((x) => x + 1)} />
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Receipt size={16} />} title="Invoices">
        {data.invoices.length === 0 ? <Empty>No invoices yet.</Empty> : (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3">
              <Figure label="Invoiced" value={formatZAR(data.invoices.reduce((s, i) => s + i.total, 0))} />
              <Figure label="Paid" value={formatZAR(paid)} />
              <Figure label="Still owing" value={formatZAR(owing)} strong={owing > 0} />
            </div>
            <ul className="divide-y divide-slate-100" data-testid="portal-invoices">
              {data.invoices.map((i) => (
                <li key={i.number + i.issued} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800">{i.number || 'Invoice'} <span className="font-normal text-slate-500">· {formatDate(i.issued)}</span></p>
                    <p className="truncate text-xs text-slate-500">{[i.project, i.description].filter(Boolean).join(' · ') || ' '}{i.due && i.state !== 'paid' ? ` · due ${formatDate(i.due)}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular text-slate-800">{formatZAR(i.total)}</span>
                    <Pill tone={i.state === 'paid' ? 'good' : i.state === 'overdue' ? 'bad' : 'wait'}>
                      {i.state === 'paid' ? 'Paid' : `${formatZAR(i.owing)} owing${i.state === 'overdue' ? ', overdue' : ''}`}
                    </Pill>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <footer className="border-t border-slate-200 pt-4 text-sm text-slate-500">
        Questions about your project? Contact {me.company.name}
        {me.company.phone && <> on <a className="text-brand-600 hover:underline" href={`tel:${me.company.phone.replace(/\s/g, '')}`}>{me.company.phone}</a></>}
        {me.company.email && <> or <a className="break-all text-brand-600 hover:underline" href={`mailto:${me.company.email}`}>{me.company.email}</a></>}.
      </footer>
    </div>
  )
}

/*
 * A QUOTE: its total and where it stands, the PDF as the office sends it, and -- while it is waiting for the
 * client's answer and still valid -- Accept. Raptor has no quote to accept (Remus's own): the client types their
 * full name and ticks that they accept the quote and its terms; the office is told in the bell.
 */
function QuoteRow({ q, token, me, onSignedOut, onAccepted }: { q: PortalQuote; token: string; me: PortalMe; onSignedOut: () => void; onAccepted: () => void }) {
  const [accepting, setAccepting] = useState(false)
  const [name, setName] = useState(me.name)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState<'pdf' | 'accept' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fail = (e: unknown) => { if (e instanceof PortalSignedOut) onSignedOut(); else setError(e instanceof Error ? e.message : String(e)) }

  async function openPdf() {
    setBusy('pdf'); setError(null)
    /* Opened before the wait, inside the tap: a phone's browser blocks a window opened after it. */
    const win = window.open('', '_blank')
    try {
      const url = URL.createObjectURL(await fetchPortalQuotePdf(token, q.id))
      if (win) win.location.href = url
      else {
        const a = document.createElement('a')
        a.href = url; a.download = `${q.number ?? 'Quote'}.pdf`; a.click()
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) { win?.close(); fail(e) } finally { setBusy(null) }
  }

  async function accept(e: FormEvent) {
    e.preventDefault()
    setBusy('accept'); setError(null)
    try { await acceptPortalQuote(token, q.id, name, agreed); setAccepting(false); onAccepted() } catch (x) { fail(x) } finally { setBusy(null) }
  }

  return (
    <li className="px-4 py-3 text-sm" data-testid="portal-quote">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{q.title || 'Quote'}</p>
          <p className="text-xs text-slate-500">{q.number ? `${q.number} · ` : ''}{formatDate(q.issued)}{q.validUntil && q.canAccept ? ` · valid until ${formatDate(q.validUntil)}` : ''}</p>
          {q.acceptedOnPortal && (
            <p className="mt-0.5 text-xs text-emerald-700" data-testid="portal-quote-accepted">Accepted here by {q.acceptedOnPortal.by}, {formatDateTime(q.acceptedOnPortal.at)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {q.total !== null && <span className="tabular text-slate-800">{formatZAR(q.total)}</span>}
          <Pill tone={q.status === 'Accepted' ? 'good' : q.status.startsWith('Waiting') ? 'wait' : 'muted'}>{q.status}</Pill>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void openPdf()} disabled={busy !== null} data-testid="portal-quote-pdf"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Download size={13} /> {busy === 'pdf' ? 'Opening…' : 'Quote PDF'}
        </button>
        {q.canAccept && !accepting && (
          <button type="button" onClick={() => { setAccepting(true); setError(null) }} data-testid="portal-quote-accept-open"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600">
            <Check size={13} /> Accept this quote
          </button>
        )}
      </div>
      {accepting && (
        <form onSubmit={accept} className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" data-testid="portal-quote-accept">
          <p className="text-slate-700">
            You are accepting quote {q.number ?? ''}{q.total !== null ? <> for <b className="tabular">{formatZAR(q.total)}</b></> : null}, as set out in the PDF.
            {' '}{me.company.name} will be in touch to plan the work.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Your full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" className="input w-full" data-testid="portal-accept-name" />
          </label>
          <label className="flex items-start gap-2 text-slate-700">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-ink-950" data-testid="portal-accept-tick" />
            I accept this quote and its terms.
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy !== null || !agreed || name.trim().length < 2} data-testid="portal-accept-confirm"
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink-950 px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              <Check size={15} /> {busy === 'accept' ? 'Saving…' : 'Accept quote'}
            </button>
            <button type="button" onClick={() => { setAccepting(false); setError(null) }} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          </div>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-700" data-testid="portal-quote-error">{error}</p>}
    </li>
  )
}

const STATE_DOT: Record<PortalStageState, string> = {
  done: 'bg-emerald-500', on: 'bg-brand-500 ring-4 ring-brand-500/20', next: 'bg-slate-300', unplanned: 'bg-slate-200',
}

function ProjectCard({ p }: { p: PortalProject }) {
  return (
    <article className="card overflow-hidden" data-testid="portal-project">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">{p.name}</h3>
            {p.siteAddress && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} className="shrink-0" /> <span className="truncate">{p.siteAddress}</span></p>}
          </div>
          <Pill tone={p.status === 'Finished' ? 'good' : p.status === 'On hold' ? 'bad' : p.status === 'Under way' ? 'wait' : 'muted'}>{p.status}</Pill>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          {p.start || p.finish ? (
            <>
              <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> Start {formatDate(p.start)}</span>
              <span>Planned finish {formatDate(p.finish)}</span>
            </>
          ) : <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> The dates follow once the work is planned.</span>}
        </div>
        {p.progress !== null && (
          <div>
            <div className="mb-1 flex justify-between text-xs"><span className="text-slate-500">Progress, by the plan</span><span className="tabular font-medium text-slate-800">{p.progress}%</span></div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.progress}%` }} />
            </div>
          </div>
        )}
      </div>
      {p.stages.length > 0 && (
        <ol className="border-t border-slate-100 px-4 py-3 sm:px-5" data-testid="portal-stages">
          {p.stages.map((s, i) => (
            <li key={`${s.name}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
              {i < p.stages.length - 1 && <span className="absolute top-3 left-[5px] h-full w-px bg-slate-200" />}
              <span className={clsx('relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full', STATE_DOT[s.state])} />
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
                <p className={clsx('text-sm', s.state === 'on' ? 'font-semibold text-slate-900' : 'text-slate-700')}>{s.name}</p>
                <p className="text-xs text-slate-500">
                  {s.start && s.end ? `${formatDate(s.start, 'd MMM')} – ${formatDate(s.end, 'd MMM')}` : ''} · {s.stateLabel}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {(p.start || p.finish) && <p className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500 sm:px-5">Dates are the plan. Weather, deliveries and changes to the work can move them.</p>}
      {p.photos.length > 0 && <SitePhotos photos={p.photos} />}
      {p.notes.length > 0 && <ProgressNotes notes={p.notes} />}
    </article>
  )
}

/** Site photos the office ticked "Client sees": a grid of squares, tap one to see it whole. */
function SitePhotos({ photos }: { photos: PortalProject['photos'] }) {
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const shown = all ? photos : photos.slice(0, 6)
  const big = open === null ? null : photos[open]
  return (
    <div className="border-t border-slate-100 px-4 py-3 sm:px-5" data-testid="portal-photos">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Camera size={13} className="text-brand-600" /> From site</p>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {shown.map((ph, i) => (
          <button key={ph.id} type="button" onClick={() => setOpen(i)} aria-label={`Open the photo from ${formatDate(ph.date)}`}
            className="aspect-square overflow-hidden rounded-md bg-slate-100 ring-1 ring-slate-200" data-testid="portal-photo">
            <img src={ph.url} alt={ph.caption ?? ''} loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
      {photos.length > 6 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-medium text-brand-600 hover:underline">
          {all ? 'Show fewer' : `Show all ${photos.length} photos`}
        </button>
      )}
      {big && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <button type="button" className="absolute top-3 right-3 rounded-full bg-white/90 p-1.5 text-slate-800" aria-label="Close" onClick={() => setOpen(null)}><X size={18} /></button>
          <img src={big.url} alt={big.caption ?? ''} className="max-h-[80dvh] max-w-full rounded object-contain" onClick={(e) => e.stopPropagation()} />
          <p className="mt-3 text-center text-sm text-white/80">{[formatDate(big.date), big.caption].filter(Boolean).join(' · ')}</p>
        </div>
      )}
    </div>
  )
}

/** The days the office wrote up for the client: the newest three, the rest on a tap. */
function ProgressNotes({ notes }: { notes: PortalProject['notes'] }) {
  const [all, setAll] = useState(false)
  const shown = all ? notes : notes.slice(0, 3)
  return (
    <div className="border-t border-slate-100 px-4 py-3 sm:px-5" data-testid="portal-notes">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><NotebookPen size={13} className="text-brand-600" /> Progress notes</p>
      <ul className="space-y-2.5">
        {shown.map((nt) => (
          <li key={nt.date} className="text-sm">
            <p className="text-xs font-medium text-slate-500">{formatDate(nt.date, 'EEE d MMM yyyy')}</p>
            <p className="break-words whitespace-pre-line text-slate-700">{nt.text}</p>
          </li>
        ))}
      </ul>
      {notes.length > 3 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-medium text-brand-600 hover:underline">
          {all ? 'Show fewer' : `Show all ${notes.length} notes`}
        </button>
      )}
    </div>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-500 uppercase"><span className="text-brand-600">{icon}</span>{title}</h2>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="card px-4 py-5 text-sm text-slate-500">{children}</p>
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="bg-white px-4 py-3 last:col-span-2 sm:last:col-span-1">
      <p className="text-[11px] tracking-wider text-slate-400 uppercase">{label}</p>
      <p className={clsx('tabular mt-0.5 text-lg', strong ? 'font-semibold text-slate-900' : 'text-slate-800')}>{value}</p>
    </div>
  )
}

function Pill({ tone, children }: { tone: 'good' | 'bad' | 'wait' | 'muted'; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', {
      'bg-emerald-50 text-emerald-700': tone === 'good',
      'bg-red-50 text-red-700': tone === 'bad',
      'bg-brand-50 text-brand-700': tone === 'wait',
      'bg-slate-100 text-slate-600': tone === 'muted',
    })}>{children}</span>
  )
}
