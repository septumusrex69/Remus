import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CalendarDays, FileText, HardHat, MapPin, Receipt } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDate, formatZAR } from '../../lib/format'
import {
  PortalSignedOut, fetchPortalMe, fetchPortalOverview, portalSignOut, portalToken, requestPortalCode, savePortalToken,
  verifyPortalCode, type PortalMe, type PortalOverview, type PortalProject, type PortalStageState,
} from '../../lib/portalApi'

/**
 * THE CLIENT PORTAL (Remus · Handoff 5, Raptor H13's PortalPage) -- outside the app: no staff login, no
 * staff navigation. A client types their email, is emailed a code, and follows their job.
 *
 * Stephan: "To see their progresses and things." Phase 1: each project and where its stages stand on
 * the plan, the quotes sent to them, and their invoices with what is paid. The company's own name and
 * logo from Settings (a client-facing page, like a quote), with the skin's colours.
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

  return (
    <div className="min-h-dvh bg-slate-50" data-testid="portal-page">
      <header className="bg-ink-950 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {me?.company.logoUrl && <img src={me.company.logoUrl} alt="" className="h-10 max-w-28 shrink-0 rounded bg-white object-contain p-1" />}
            <div className="min-w-0">
              <p className="truncate text-[11px] tracking-wider text-white/60 uppercase">{me?.company.name ?? 'Client portal'}</p>
              <p className="truncate text-lg leading-tight font-semibold">{me ? me.client : 'Your building work'}</p>
            </div>
          </div>
          {me && token && (
            <div className="shrink-0 text-right text-sm">
              <p className="max-w-40 truncate text-white/80">{me.name || me.email}</p>
              <button type="button" className="text-xs text-white/60 underline" onClick={() => { portalSignOut(token).catch(() => {}); signedOut() }}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        {!token ? <SignIn onSignedIn={(t) => { savePortalToken(t); setToken(t) }} />
          : !me ? <p className="text-sm text-slate-400">Opening your projects…</p>
            : <Overview token={token} me={me} onSignedOut={signedOut} />}
      </main>
    </div>
  )
}

function SignIn({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true); setError(null)
    try { setSent((await requestPortalCode(email)).message) } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }
  async function check(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try { onSignedIn((await verifyPortalCode(email, code)).token) } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  return (
    <div className="card mx-auto mt-8 max-w-md p-6 sm:p-8" data-testid="portal-sign-in">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Sign in</h1>
      <p className="mb-5 text-sm text-slate-600">Type the email address you were invited with. We email you a code; there is no password.</p>
      {!sent ? (
        <form onSubmit={send} className="space-y-3">
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.co.za" className="input w-full" data-testid="portal-email" />
          <button type="submit" disabled={busy || !email} className="w-full rounded-lg bg-brand-500 py-2.5 font-medium text-white hover:bg-brand-600 disabled:opacity-50">Email me a code</button>
        </form>
      ) : (
        <form onSubmit={check} className="space-y-3">
          <p className="text-sm text-slate-600" data-testid="portal-code-sent">{sent}</p>
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="123 456" className="input w-full text-lg tracking-widest" data-testid="portal-code" />
          <button type="submit" disabled={busy || !code} className="w-full rounded-lg bg-brand-500 py-2.5 font-medium text-white hover:bg-brand-600 disabled:opacity-50">Sign in</button>
          <div className="flex justify-between text-xs text-slate-500">
            <button type="button" className="underline" onClick={() => { setSent(null); setCode('') }}>Use another address</button>
            <button type="button" className="underline" disabled={busy} onClick={() => void send()}>Send a new code</button>
          </div>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-red-700" data-testid="portal-error">{error}</p>}
    </div>
  )
}

function Overview({ token, me, onSignedOut }: { token: string; me: PortalMe; onSignedOut: () => void }) {
  const [data, setData] = useState<PortalOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetchPortalOverview(token)
      .then((d) => { if (live) setData(d) })
      .catch((e: Error) => { if (!live) return; if (e instanceof PortalSignedOut) onSignedOut(); else setError(e.message) })
    return () => { live = false }
  }, [token, onSignedOut])

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
                    <p className="truncate text-xs text-slate-500">{[i.project, i.description].filter(Boolean).join(' · ') || ' '}{i.due && i.state !== 'paid' ? ` · due ${formatDate(i.due)}` : ''}</p>
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

      <Section icon={<FileText size={16} />} title="Quotes">
        {data.quotes.length === 0 ? <Empty>No quotes yet.</Empty> : (
          <ul className="card divide-y divide-slate-100 overflow-hidden" data-testid="portal-quotes">
            {data.quotes.map((q) => (
              <li key={(q.number ?? '') + q.issued + q.title} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{q.title}</p>
                  <p className="text-xs text-slate-500">{q.number ? `${q.number} · ` : ''}{formatDate(q.issued)}{q.validUntil && q.status.startsWith('Waiting') ? ` · valid until ${formatDate(q.validUntil)}` : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  {q.total !== null && <span className="tabular text-slate-800">{formatZAR(q.total)}</span>}
                  <Pill tone={q.status === 'Accepted' ? 'good' : q.status.startsWith('Waiting') ? 'wait' : 'muted'}>{q.status}</Pill>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="border-t border-slate-200 pt-4 text-sm text-slate-500">
        Questions about your project? Contact {me.company.name}
        {me.company.phone && <> on <a className="text-brand-600 hover:underline" href={`tel:${me.company.phone.replace(/\s/g, '')}`}>{me.company.phone}</a></>}
        {me.company.email && <> or <a className="text-brand-600 hover:underline" href={`mailto:${me.company.email}`}>{me.company.email}</a></>}.
      </footer>
    </div>
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
    </article>
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
