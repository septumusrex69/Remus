import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import { useBuild } from '../../pages/build/BuildContext'
import { photoFor } from '../../lib/brandPhotos'

/**
 * THE SHAPE EVERY RECORD PAGE WEARS (Remus · Handover 8), copied from Raptor's
 * `components/record/RecordShell.tsx` and `components/dashboard/DashboardHero.tsx`.
 *
 * Stephan: "when we build things, build it exactly like Raptor." Raptor's record pages share one
 * grammar: a dark band naming the record, a row of figures you can read at a glance, then tabs over
 * the detail. Somebody learns it once and reads every project and client the same way. These are the
 * pieces of it and nothing more: no data, no fetching.
 *
 * What is different from Raptor, and why:
 *  - The band is Remus's `skin-band` (the dashboard's), so each skin draws it its own way: plain ink on
 *    Remus and Urban Haus Classic, the construction photograph under black glass on Platinum, the city
 *    drawing on Platinum Night. Raptor's band carries its gold ring mark; Remus's frame already carries
 *    the REMUS wordmark, so the band has no mark.
 *  - Raptor's gold is `brand-*` and its navy text is `slate-900` (not `ink-950`: on Platinum Night ink is
 *    the black ground, and dark words on a dark page vanish).
 *  - The record's code sits in a frosted chip rather than Raptor's gold one, which read poorly on the
 *    silver and graphite skins.
 *  - The actions sit in the band, as on Remus's dashboard, because a project or a client has two or three
 *    of them, not Raptor's twelve. Raptor's "More" menu and layout switcher are left out until a page
 *    needs them.
 */

/* ------------------------------------------------------------------ *
 * The band
 * ------------------------------------------------------------------ */

export function RecordHero({ eyebrow, title, code, subtitle, facts, actions }: {
  /** The kind of record, in small capitals: "Project", "Company client". */
  eyebrow: ReactNode
  title: ReactNode
  /** The record's own number (a project code), shown beside the name. */
  code?: string | null
  /** One line under the name: who it is for, where it is. */
  subtitle?: ReactNode
  /** Small facts as chips under that: status, dates, how far along. */
  facts?: ReactNode
  /** What you can do, on the right (stacks under the name on a phone). */
  actions?: ReactNode
}) {
  const { settings, dayLook } = useBuild()
  const credit = (dayLook?.approved ? dayLook.photo : photoFor('band', settings?.brand_photos)).credit
  return (
    <section className="skin-band skin-band-record relative overflow-hidden rounded-2xl bg-ink-950 px-5 py-5 text-white sm:px-7 sm:py-6" data-testid="record-hero">
      <span className="skin-band-credit absolute right-3 bottom-1.5 hidden text-[9px] text-white/40">Photo: {credit} / Unsplash</span>
      <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-72">
          <p className="mb-1 text-[11px] font-bold tracking-[0.1em] text-brand-300 uppercase">{eyebrow}</p>
          <h2 className="text-xl font-extrabold tracking-tight break-words sm:text-2xl">
            {title}
            {code && (
              <span className="ml-2 inline-block rounded-md bg-white/15 px-2 py-0.5 align-middle font-mono text-[11px] font-bold text-white ring-1 ring-white/20">{code}</span>
            )}
          </h2>
          {subtitle && <div className="mt-0.5 text-[13px] break-words text-white/70">{subtitle}</div>}
          {facts && <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{facts}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  )
}

/** A chip of fact under the record's name (Raptor's client-hero tags). */
export function HeroFact({ icon: Icon, children, dot }: { icon?: LucideIcon; children: ReactNode; dot?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11.5px] font-medium text-white">
      {dot && <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />}
      {Icon && <Icon size={12} className="shrink-0 text-white/70" />}
      <span className="truncate">{children}</span>
    </span>
  )
}

const HERO_ACTION = 'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors'
const heroActionClass = (primary?: boolean, danger?: boolean) => clsx(
  HERO_ACTION,
  primary ? 'bg-brand-500 font-semibold text-white hover:bg-brand-600'
    : danger ? 'bg-white/10 text-white/80 hover:bg-red-600 hover:text-white'
      : 'bg-white/10 text-white hover:bg-white/20',
)

/** A button in the band, in the dashboard band's two looks: the one thing the page is for, and the rest. */
export function HeroAction({ icon: Icon, label, onClick, to, primary, danger, title }: {
  icon: LucideIcon
  /** Empty for an icon-only button (Delete); the title then names it. */
  label?: string
  onClick?: () => void
  to?: string
  primary?: boolean
  danger?: boolean
  title?: string
}) {
  const body = <><Icon size={16} />{label}</>
  if (to) return <Link to={to} title={title} className={heroActionClass(primary, danger)}>{body}</Link>
  return (
    <button type="button" onClick={onClick} title={title} aria-label={label ? undefined : title} className={heroActionClass(primary, danger)}>
      {body}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Figures
 * ------------------------------------------------------------------ */

/**
 * One figure under the band (Raptor's RecordFigure). `small` is for the ones holding words rather than
 * money, so a date does not read as the most important thing on the page.
 */
export function RecordFigure({ label, value, note, strong, tone, small, icon: Icon, aside, onClick, title }: {
  label: string
  value: ReactNode
  note?: ReactNode
  /** The one figure the page is really about. */
  strong?: boolean
  tone?: 'good' | 'bad'
  small?: boolean
  icon?: LucideIcon
  /** A small drawing in the icon's place (a progress ring). Wins over `icon`. */
  aside?: ReactNode
  onClick?: () => void
  title?: string
}) {
  const text = (
    <>
      <p className="text-[10px] tracking-wide text-slate-400 uppercase">{label}</p>
      <p className={clsx('mt-0.5 font-semibold', small ? 'text-sm leading-snug' : 'tabular text-lg',
        tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-700' : strong ? 'text-slate-900' : 'text-slate-800')}>{value}</p>
      {note && <p className={clsx('mt-0.5 text-[11px] leading-snug', tone === 'bad' ? 'text-red-700' : 'text-slate-500')}>{note}</p>}
    </>
  )
  const body = aside || Icon ? (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700" aria-hidden>
        {aside ?? (Icon && <Icon size={18} />)}
      </span>
      <div className="min-w-0">{text}</div>
    </div>
  ) : text
  const shell = clsx('card min-w-0 px-3.5 py-2.5', strong && 'border-brand-200')
  if (!onClick) return <div className={shell}>{body}</div>
  return (
    <button type="button" onClick={onClick} title={title}
      className={clsx(shell, 'text-left hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40')}>
      {body}
    </button>
  )
}

/** The row of figures: two across on a phone whatever the count, then as many as it was given. */
export function RecordFigures({ children, count }: { children: ReactNode; count: number }) {
  const wide = count >= 6 ? 'lg:grid-cols-6' : count === 5 ? 'lg:grid-cols-5' : count === 4 ? 'lg:grid-cols-4' : count === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
  return <div className={clsx('grid grid-cols-2 gap-2.5', wide)}>{children}</div>
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

export interface RecordTab<T extends string> {
  id: T
  label: string
  /** Shown beside the label, so you can see there is nothing in there without opening it. */
  count?: number
}

/**
 * The tab strip over a record's detail (Raptor's RecordTabs). THE STRIP SCROLLS; THE PAGE DOES NOT:
 * eight tabs are far wider than a phone, so the row scrolls sideways on its own and the page stays put.
 */
export function RecordTabs<T extends string>({ tabs, active, onChange }: {
  tabs: RecordTab<T>[]
  active: T
  onChange: (id: T) => void
}) {
  return (
    <div className="no-print border-b border-slate-200" role="tablist">
      <div className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" onClick={() => onChange(t.id)}
            aria-selected={active === t.id}
            className={clsx('shrink-0 border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap',
              active === t.id ? 'border-brand-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t.label}
            {t.count !== undefined && <span className="tabular ml-1.5 text-[11px] text-slate-400">{t.count}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
