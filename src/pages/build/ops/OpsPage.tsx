import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, format, parseISO, startOfMonth, subMonths } from 'date-fns'
import { AlertTriangle, ArrowUpRight, CalendarClock, HardHat, MapPin, Users, X } from 'lucide-react'
import { payments as paymentsApi, placeAddress, projects as projectsApi, quotes as quotesApi } from '../../../lib/api'
import { loadScoreSources, scoreProject } from '../../../lib/projectScores'
import { projectProgress } from '../../../lib/projectProgress'
import { budgetColour, type BudgetColour } from '../../../lib/budgetLevel'
import { workedDays } from '../../../lib/crewDays'
import { workingDaysIn } from '../../../lib/workdays'
import { formatDate, formatZAR, todayYmd, ymd } from '../../../lib/format'
import { seesBudget, seesMoney, seesQuotes, useAccess } from '../../../lib/access'
import { useLoad } from '../../../hooks/useLoad'
import { Spinner, ErrorBanner } from '../../../components/ui'
import { useBuild } from '../BuildContext'
import { paths } from '../paths'
import type { OpsPoint } from './OpsMap'
import type { Project } from '../../../types'
import './ops.css'

const OpsMap = lazy(() => import('./OpsMap'))

/**
 * OPERATIONS (Remus · Handover 6). Stephan sent three dark boards -- a fleet map with a vehicle card, gauges and a
 * compass; a finance board with capsule bars and a heat grid; a fitness board with a big gauge -- "build me ... a
 * new dashboard ... I like the one with ... the map". So: every running and coming job on a dark map, a job card
 * that opens over it (where the job is, how far along, the budget as a gauge, who is there), and glass panels under
 * it: the budget of every job as capsules, the crew's days as a grid, money in, and how full the company is.
 * The same sums as the rest of Remus (projectScores, projectProgress, crewDays), so the numbers agree everywhere.
 */
async function load() {
  const today = todayYmd()
  const projects = await projectsApi.list()
  const [src, payments, quotes] = await Promise.all([
    loadScoreSources(projects, ymd(addDays(new Date(), -35)), today),
    paymentsApi.list().catch(() => []),
    quotesApi.list().catch(() => []),
  ])
  return { projects, src, payments, quotes }
}

// Platinum's signals, lifted for a dark board: Steel on track, Brass getting close, Ember over.
const COLOUR: Record<BudgetColour, string> = { green: '#9eaab4', yellow: '#b89a62', red: '#b65a48', grey: '#5f636b' }
const running = (p: Project) => p.status === 'active' || p.status === 'on_hold'

/* ---------- Where each site is: looked up once, kept in this browser ---------- */
const POINTS_KEY = 'remus.sitePoints'
function readPoints(): Record<string, { lat: number; lon: number } | null> {
  try { return JSON.parse(localStorage.getItem(POINTS_KEY) || '{}') } catch { return {} }
}
function useSitePoints(projects: Project[]) {
  const [points, setPoints] = useState(readPoints)
  useEffect(() => {
    let stop = false
    ;(async () => {
      for (const p of projects) {
        const address = p.site_address?.trim()
        if (!address || address in points) continue
        // The full address, else from the suburb on ("12 Rigel Road, Lynnwood, Pretoria" -> "Lynnwood, Pretoria").
        const tries = [address, address.split(',').slice(1).join(',').trim()].filter(Boolean)
        let hit: { lat: number; lon: number } | null = null
        for (const t of tries) {
          try { const g = await placeAddress(t); hit = { lat: g.lat, lon: g.lon }; break } catch { /* next */ }
        }
        if (stop) return
        setPoints((prev) => {
          const next = { ...prev, [address]: hit }
          try { localStorage.setItem(POINTS_KEY, JSON.stringify(next)) } catch { /* fine */ }
          return next
        })
      }
    })()
    return () => { stop = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects])
  return points
}

export function OpsPage() {
  const { data, error, loading } = useLoad(load, [], 'ops')
  const { settings } = useBuild()
  const access = useAccess()
  const budget = seesBudget(access)
  const money = seesMoney(access)
  const today = todayYmd()
  const [selected, setSelected] = useState<string | null>(null)

  const live = useMemo(() => (data ? data.projects.filter((p) => running(p) || (p.status === 'planned' && p.start_date && p.start_date <= ymd(addDays(new Date(), 45)))) : []), [data])
  const points = useSitePoints(live)

  const view = useMemo(() => {
    if (!data) return null
    const scores = new Map(live.map((p) => [p.id, scoreProject(p, data.src, today)]))
    const stagesOf = (id: string) => data.src.stages.filter((s) => s.project_id === id)
    const progress = new Map(live.map((p) => [p.id, projectProgress(p.status, stagesOf(p.id), today)]))
    const colourOf = (p: Project): BudgetColour => (p.status === 'planned' ? 'grey' : budgetColour(scores.get(p.id)!, running(p)))
    const days = workedDays(data.src.crew, ymd(addDays(new Date(), -27)), today)
    const onSiteToday = new Set(days.filter((d) => d.day === today && d.days > 0).map((d) => d.worker_id))
    const bookedToday = data.src.crew.bookings.filter((b) => b.start_date <= today && b.end_date >= today)
    const crewToday = onSiteToday.size || new Set(bookedToday.map((b) => b.worker_id)).size
    const alerts = live.filter((p) => running(p) && ['yellow', 'red'].includes(colourOf(p)))
    const openQuotes = data.quotes.filter((q) => q.status === 'sent').length
    const months = Array.from({ length: 6 }, (_, i) => format(startOfMonth(subMonths(new Date(), 5 - i)), 'yyyy-MM'))
    const moneyIn = months.map((m) => data.payments.filter((x) => x.date?.startsWith(m)).reduce((t, x) => t + Number(x.amount), 0))
    return { scores, progress, colourOf, stagesOf, days, crewToday, alerts, openQuotes, months, moneyIn }
  }, [data, live, today])

  if (loading && !data) return <Spinner page />
  if (!data || !view) return <ErrorBanner error={error} />

  const runningJobs = live.filter(running)
  const capacity = settings?.max_jobs ?? 4
  const mapPoints: OpsPoint[] = live.flatMap((p) => {
    const pt = p.site_address ? points[p.site_address.trim()] : null
    return pt ? [{ id: p.id, lat: pt.lat, lon: pt.lon, name: p.name, colour: COLOUR[view.colourOf(p)] }] : []
  })
  const sel = live.find((p) => p.id === selected) ?? null
  const unplaced = live.filter((p) => !p.site_address || points[p.site_address.trim()] === null)

  return (
    <div className="ops-board -mx-1 space-y-4 sm:mx-0" data-testid="ops-board">
      {/* ---------- Heading and the figures as pills ---------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
          <p className="ops-dim text-[13px]">{format(new Date(), 'EEEE d MMMM yyyy')} · every site, where it stands</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="ops-pill"><HardHat size={13} /> Running <b>{runningJobs.length}/{capacity}</b></span>
          <span className="ops-pill"><Users size={13} /> Crew today <b>{view.crewToday}</b></span>
          {seesQuotes(access) && <span className="ops-pill">Quotes out <b>{view.openQuotes}</b></span>}
          {budget && <span className="ops-pill" style={view.alerts.length ? { color: 'var(--ops-warn)' } : undefined}><AlertTriangle size={13} /> Budget alerts <b>{view.alerts.length}</b></span>}
        </div>
      </div>

      {/* ---------- The map, the job card over it, the sites beside it ---------- */}
      <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
        <div className="ops-panel relative h-[460px] overflow-hidden sm:h-[540px]" data-testid="ops-map">
          <Suspense fallback={<div className="grid h-full place-items-center ops-dim">Loading the map…</div>}>
            <OpsMap points={mapPoints} selected={selected} onSelect={setSelected} />
          </Suspense>
          <Compass />
          {sel && (
            <JobCard p={sel} score={view.scores.get(sel.id)!} progress={view.progress.get(sel.id) ?? null} colour={view.colourOf(sel)}
              stages={view.stagesOf(sel.id)} crew={data.src.crew.bookings.filter((b) => b.start_date <= today && b.end_date >= today && view.stagesOf(sel.id).some((s) => s.id === b.stage_id)).map((b) => data.src.crew.workers.get(b.worker_id)?.name ?? 'Worker')}
              budget={budget} onClose={() => setSelected(null)} />
          )}
          {!sel && live.length > 0 && <p className="ops-glass pointer-events-none absolute left-4 top-4 z-[500] px-3 py-2 text-xs ops-dim">Tap a site to open it</p>}
          {unplaced.length > 0 && <p className="absolute bottom-2 left-3 z-[500] text-[10px] ops-dim">Not on the map (no address found): {unplaced.map((p) => p.code || p.name).join(', ')}</p>}
        </div>

        <div className="ops-panel flex max-h-[540px] flex-col p-3">
          <p className="ops-label px-1 pb-2">Sites · {live.length}</p>
          <ul className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {live.map((p) => {
              const pr = view.progress.get(p.id) ?? null
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => setSelected(p.id)} data-testid="ops-site"
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5"
                    style={p.id === selected ? { background: 'rgba(230,232,235,0.08)', boxShadow: 'inset 0 0 0 1px rgba(230,232,235,0.35)' } : undefined}>
                    <Ring value={pr} size={40} colour={p.status === 'planned' ? '#8b9098' : 'var(--ops-accent)'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{p.name}</span>
                      <span className="block truncate text-[11px] ops-dim">
                        {p.status === 'planned' ? `Starts ${formatDate(p.start_date!, 'd MMM')}` : `To ${formatDate(p.end_date, 'd MMM')}`}
                      </span>
                    </span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLOUR[view.colourOf(p)], boxShadow: `0 0 10px ${COLOUR[view.colourOf(p)]}` }} />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {/* ---------- The panels underneath ---------- */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {budget && <BudgetCapsules jobs={runningJobs} scores={view.scores} colourOf={view.colourOf} selected={selected} onSelect={setSelected} />}
        <CrewGrid days={view.days} today={today} />
        {money && <MoneyIn months={view.months} values={view.moneyIn} />}
        <Capacity running={runningJobs.length} capacity={capacity} />
      </div>
    </div>
  )
}

/* ---------- The job card over the map (the fleet board's vehicle card) ---------- */
function JobCard({ p, score, progress, colour, stages, crew, budget, onClose }: {
  p: Project; score: ReturnType<typeof scoreProject>; progress: number | null; colour: BudgetColour
  stages: { name: string; start_date: string | null; end_date: string | null }[]; crew: string[]; budget: boolean; onClose: () => void
}) {
  const today = todayYmd()
  const now = stages.find((s) => s.start_date && s.end_date && s.start_date <= today && s.end_date >= today)
  const left = p.end_date && p.end_date >= today ? workingDaysIn(today, p.end_date).length : 0
  const warn = colour === 'red' ? 'Nearly at the end of the budget, or over it' : colour === 'yellow' ? 'Getting close to the budget' : null
  return (
    <div className="ops-glass absolute left-3 right-3 top-3 z-[500] max-h-[calc(100%-1.5rem)] overflow-y-auto p-4 sm:left-4 sm:right-auto sm:w-[360px]" data-testid="ops-jobcard">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-semibold"><HardHat size={16} className="ops-accent" /> <span className="truncate">{p.name}</span></p>
          <p className="mt-0.5 truncate text-[11px] ops-dim">{p.code ? `${p.code} · ` : ''}{p.site_address ?? 'No address'}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 ops-dim hover:bg-white/10"><X size={15} /></button>
      </div>

      {/* Start to finish, like the board's route line. */}
      <div className="ops-panel mt-3 p-3">
        <div className="flex justify-between text-[11px]">
          <span><MapPin size={11} className="mr-1 inline" />{p.start_date ? formatDate(p.start_date, 'd MMM') : '—'}</span>
          <span className="ops-dim">{p.status === 'planned' ? 'Booked' : now ? (now.name || 'General') : 'Between stages'}</span>
          <span>{p.end_date ? formatDate(p.end_date, 'd MMM') : '—'}</span>
        </div>
        <div className="relative mt-2 h-1.5 rounded-full" style={{ background: 'repeating-linear-gradient(90deg, #3b3e44 0 2px, transparent 2px 6px)' }}>
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${progress ?? 0}%`, background: 'var(--ops-accent)', boxShadow: '0 0 12px rgba(230,232,235,0.6)' }} />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] ops-dim"><CalendarClock size={12} /> {p.status === 'completed' ? 'Finished' : `${left} working day${left === 1 ? '' : 's'} left`}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="ops-panel flex flex-col items-center p-2.5">
          <p className="ops-label self-start">How far along</p>
          <Ring value={progress} size={104} colour="var(--ops-accent)" label="by the plan" />
        </div>
        <div className="ops-panel flex flex-col items-center p-2.5">
          <p className="ops-label self-start">Budget used</p>
          {budget ? <Gauge value={score.costPct} colour={COLOUR[colour]} /> : <p className="my-auto text-xs ops-dim">—</p>}
        </div>
      </div>

      {warn && budget && (
        <p className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: colour === 'red' ? 'rgba(182,90,72,0.14)' : 'rgba(184,154,98,0.14)', color: colour === 'red' ? 'var(--ops-bad)' : 'var(--ops-warn)' }}>
          <AlertTriangle size={14} /> {warn}: {score.costPct}% of the quoted cost used.
        </p>
      )}
      <p className="mt-3 text-[11px] ops-dim"><Users size={12} className="mr-1 inline" />{crew.length ? `On site: ${[...new Set(crew)].join(', ')}` : 'Nobody booked today'}</p>
      <Link to={paths.project(p.id)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium ops-accent hover:underline">Open the job <ArrowUpRight size={13} /></Link>
    </div>
  )
}

/* ---------- Drawn pieces ---------- */

/** A ring: thick arc for done, fine ticks for the rest (the progress dial, in the board's colours). */
export function Ring({ value, size, colour, label }: { value: number | null; size: number; colour: string; label?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  const small = size < 80
  const r = small ? 42 : 40
  const len = 2 * Math.PI * r
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        {Array.from({ length: 48 }, (_, i) => {
          if (value != null && (i / 48) * 100 < v + 2) return null
          const a = (i / 48) * 2 * Math.PI
          return <line key={i} x1={50 + Math.cos(a) * 36} y1={50 + Math.sin(a) * 36} x2={50 + Math.cos(a) * 44} y2={50 + Math.sin(a) * 44} stroke="#3b3e44" strokeWidth={small ? 2.2 : 1.4} strokeLinecap="round" />
        })}
        {v > 0 && <circle cx={50} cy={50} r={r} fill="none" stroke={colour} strokeWidth={small ? 8 : 8} strokeLinecap="round" strokeDasharray={`${(v / 100) * len} ${len}`} style={{ filter: 'drop-shadow(0 0 4px rgba(230,232,235,0.45))' }} />}
      </svg>
      <span className="relative text-center leading-none">
        <span className="font-semibold tracking-tight" style={{ fontSize: Math.round(size * (small ? 0.24 : 0.21)) }}>
          {value == null ? '—' : <>{v}<span style={{ fontSize: '0.62em', marginLeft: '0.04em' }}>%</span></>}
        </span>
        {label && !small && <span className="mt-1 block text-[10px] ops-dim">{label}</span>}
      </span>
    </span>
  )
}

/** The speedometer: ticks round a half circle, lit up to the figure, a needle, the budget at the 80% mark of the dial. */
export function Gauge({ value, colour }: { value: number | null; colour: string }) {
  const max = 125
  const v = value == null ? 0 : Math.max(0, Math.min(max, value))
  const ang = (x: number) => Math.PI + (x / max) * Math.PI
  const needle = ang(v)
  return (
    <span className="relative block h-[104px] w-[120px]" data-testid="ops-gauge">
      <svg viewBox="0 0 120 80" className="absolute inset-x-0 top-1 w-full">
        {Array.from({ length: 31 }, (_, i) => {
          const x = (i / 30) * max
          const a = ang(x)
          const lit = value != null && x <= v
          const major = i % 6 === 0
          return <line key={i} x1={60 + Math.cos(a) * (major ? 40 : 43)} y1={64 + Math.sin(a) * (major ? 40 : 43)} x2={60 + Math.cos(a) * 50} y2={64 + Math.sin(a) * 50}
            stroke={lit ? colour : '#3b3e44'} strokeWidth={major ? 2.2 : 1.4} strokeLinecap="round" />
        })}
        {/* The budget itself: 100%. */}
        <line x1={60 + Math.cos(ang(100)) * 36} y1={64 + Math.sin(ang(100)) * 36} x2={60 + Math.cos(ang(100)) * 53} y2={64 + Math.sin(ang(100)) * 53} stroke="#eff1f3" strokeWidth={1.5} />
        {value != null && <line x1={60} y1={64} x2={60 + Math.cos(needle) * 34} y2={64 + Math.sin(needle) * 34} stroke="#eff1f3" strokeWidth={2} strokeLinecap="round" />}
        <circle cx={60} cy={64} r={4} fill="#eff1f3" />
      </svg>
      <span className="absolute inset-x-0 bottom-0 text-center leading-none">
        <span className="text-lg font-semibold" style={{ color: colour }}>{value == null ? '—' : `${value}%`}</span>
        <span className="block text-[10px] ops-dim">of the quoted cost</span>
      </span>
    </span>
  )
}

function Compass() {
  return (
    <span aria-hidden className="ops-glass pointer-events-none absolute right-4 top-4 z-[500] hidden h-[74px] w-[74px] items-center justify-center rounded-full sm:flex">
      <svg viewBox="0 0 74 74" className="absolute inset-0">
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i / 36) * 2 * Math.PI
          return <line key={i} x1={37 + Math.cos(a) * 30} y1={37 + Math.sin(a) * 30} x2={37 + Math.cos(a) * (i % 9 === 0 ? 24 : 27)} y2={37 + Math.sin(a) * (i % 9 === 0 ? 24 : 27)} stroke="#5f636b" strokeWidth={1} />
        })}
        <path d="M37 9 L41 20 L33 20 Z" fill="#e6e8eb" />
      </svg>
      <span className="text-sm font-semibold">N</span>
    </span>
  )
}

/** Every running job's budget as a capsule (the finance board's bars): filled to the share used, coloured by level. */
function BudgetCapsules({ jobs, scores, colourOf, selected, onSelect }: {
  jobs: Project[]; scores: Map<string, ReturnType<typeof scoreProject>>; colourOf: (p: Project) => BudgetColour; selected: string | null; onSelect: (id: string) => void
}) {
  return (
    <div className="ops-panel p-4" data-testid="ops-capsules">
      <p className="ops-label">Budget used, each running job</p>
      <div className="mt-3 flex h-40 items-end justify-around gap-2">
        {jobs.length === 0 && <p className="my-auto text-xs ops-dim">No running jobs.</p>}
        {jobs.map((p) => {
          const pct = scores.get(p.id)?.costPct ?? 0
          const c = COLOUR[colourOf(p)]
          return (
            <button key={p.id} type="button" onClick={() => onSelect(p.id)} className="flex h-full flex-1 flex-col items-center gap-1.5" title={`${p.name}: ${pct}%`}>
              <span className="relative w-full max-w-[34px] flex-1 overflow-hidden rounded-full" style={{ background: '#1d1f22', boxShadow: p.id === selected ? 'inset 0 0 0 1px #e6e8eb' : undefined }}>
                <span className="absolute inset-x-0 bottom-0 rounded-full" style={{ height: `${Math.min(100, pct / 1.25)}%`, background: `linear-gradient(180deg, ${c}, ${c}55)`, boxShadow: `0 0 14px ${c}55` }} />
                <span className="absolute inset-x-0 border-t border-dashed" style={{ bottom: '80%', borderColor: 'rgba(239,241,243,0.35)' }} />
              </span>
              <span className="w-full truncate text-center text-[10px] ops-dim">{p.code ?? p.name}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[10px] ops-dim">The dashed line is the budget.</p>
    </div>
  )
}

/** The crew's days, four weeks by seven days (the finance board's grid): brighter is more people on site. */
function CrewGrid({ days, today }: { days: { day: string; days: number }[]; today: string }) {
  const start = addDays(parseISO(today), -27)
  const cells = Array.from({ length: 28 }, (_, i) => {
    const d = ymd(addDays(start, i))
    return { d, n: days.filter((x) => x.day === d).reduce((t, x) => t + x.days, 0) }
  })
  const max = Math.max(1, ...cells.map((c) => c.n))
  return (
    <div className="ops-panel p-4" data-testid="ops-crewgrid">
      <p className="ops-label">Crew days, last four weeks</p>
      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {cells.map((c) => (
          <span key={c.d} title={`${formatDate(c.d, 'EEE d MMM')}: ${c.n} crew day${c.n === 1 ? '' : 's'}`} className="aspect-square rounded-[4px]"
            style={{ background: c.n ? `rgba(230,232,235,${0.15 + 0.85 * (c.n / max)})` : '#1d1f22', boxShadow: c.d === today ? '0 0 0 1px #eff1f3' : undefined }} />
        ))}
      </div>
      <p className="mt-2 text-[10px] ops-dim">{cells.reduce((t, c) => t + c.n, 0)} crew days in all · the outlined square is today</p>
    </div>
  )
}

/** Money in by month: a soft line, the latest point lit. */
function MoneyIn({ months, values }: { months: string[]; values: number[] }) {
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => [10 + (i / (values.length - 1)) * 280, 90 - (v / max) * 70] as const)
  const path = pts.map(([x, y], i) => (i === 0 ? `M${x} ${y}` : `C${pts[i - 1][0] + 25} ${pts[i - 1][1]} ${x - 25} ${y} ${x} ${y}`)).join(' ')
  const last = pts[pts.length - 1]
  return (
    <div className="ops-panel p-4" data-testid="ops-money">
      <p className="ops-label">Money in, six months</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{formatZAR(values[values.length - 1] ?? 0, { decimals: 0 })} <span className="text-xs font-normal ops-dim">this month</span></p>
      <svg viewBox="0 0 300 100" className="mt-2 h-24 w-full">
        {[30, 55, 80].map((y) => <line key={y} x1={0} x2={300} y1={y} y2={y} stroke="#1d1f22" />)}
        <path d={`${path} L${last[0]} 100 L10 100 Z`} fill="rgba(230,232,235,0.08)" />
        <path d={path} fill="none" stroke="#e6e8eb" strokeWidth={2} style={{ filter: 'drop-shadow(0 0 6px rgba(230,232,235,0.5))' }} />
        <circle cx={last[0]} cy={last[1]} r={4} fill="#e6e8eb" />
      </svg>
      <div className="flex justify-between text-[10px] ops-dim">{months.map((m) => <span key={m}>{format(parseISO(`${m}-01`), 'MMM')}</span>)}</div>
    </div>
  )
}

/** How full the company is: the fitness board's big half-circle, running jobs against the capacity in Settings. */
function Capacity({ running, capacity }: { running: number; capacity: number }) {
  const pct = Math.round((running / Math.max(1, capacity)) * 100)
  const v = Math.min(100, pct)
  return (
    <div className="ops-panel flex flex-col items-center p-4" data-testid="ops-capacity">
      <p className="ops-label self-start">How full we are</p>
      <svg viewBox="0 0 200 110" className="mt-2 w-full max-w-[220px]">
        {Array.from({ length: 41 }, (_, i) => {
          const a = Math.PI + (i / 40) * Math.PI
          const lit = (i / 40) * 100 <= v
          return <line key={i} x1={100 + Math.cos(a) * 72} y1={100 + Math.sin(a) * 72} x2={100 + Math.cos(a) * 90} y2={100 + Math.sin(a) * 90}
            stroke={lit ? (pct > 100 ? '#b65a48' : '#e6e8eb') : '#2a2c31'} strokeWidth={2.4} strokeLinecap="round" />
        })}
      </svg>
      <p className="-mt-12 text-3xl font-semibold tracking-tight">{pct}%</p>
      <p className="mt-1 text-[11px] ops-dim">{running} of {capacity} jobs running · {pct > 100 ? 'overbooked' : pct === 100 ? 'full' : 'room for more'}</p>
    </div>
  )
}
