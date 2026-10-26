import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Loader2, X } from 'lucide-react'
import { labelize } from '../../lib/format'

// ---------- Button ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark'
const VARIANTS: Record<Variant, string> = {
  // Raptor's buttons, with Urban Haus orange where Raptor uses its brand colour.
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm',
  dark: 'bg-ink-950 text-white hover:bg-ink-900 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
  ghost: 'text-slate-500 hover:bg-slate-100',
  danger: 'bg-red-50 text-red-600 hover:bg-red-100',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'px-2.5 py-1.5 text-xs',
        size === 'md' && 'px-3.5 py-2 text-sm',
        size === 'lg' && 'px-5 py-3 text-base',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

// ---------- Layout bits ----------

/**
 * Raptor's card: soft border, large radius, a 15px title with an optional grey subtitle and no rule
 * under it. A list card (`padded={false}`) keeps a hairline under the header so rows don't run into it.
 */
export function Card({ title, subtitle, actions, children, className, padded = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('card overflow-hidden', className)}>
      {(title || actions) && (
        <header className={clsx('flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-5 pt-4', padded ? 'pb-1' : 'border-b border-slate-100 pb-3')}>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold whitespace-nowrap text-slate-800">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && 'p-5', padded && (title || actions) && 'pt-3')}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-[22px]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatTile({ label, value, hint, tone = 'default', icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'bad' | 'accent'; icon?: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-400">
        <span>{label}</span>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div
        className={clsx(
          'tabular mt-1 text-xl font-bold sm:text-2xl',
          tone === 'good' && 'text-emerald-700',
          tone === 'bad' && 'text-red-600',
          tone === 'accent' && 'text-brand-600',
          tone === 'default' && 'text-slate-800',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-slate-500">{children}</div>}
    </div>
  )
}

/**
 * First-load placeholder shaped like what is coming, so the layout doesn't jump: a few list rows,
 * or with `page` a whole page (title, figures, list).
 */
export function Spinner({ label = 'Loading…', page }: { label?: string; page?: boolean }) {
  return (
    <div role="status" aria-label={label} className="animate-pulse">
      {page && (
        <>
          <div className="mb-5 h-7 w-48 rounded-md bg-slate-200" />
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-slate-200/70" />)}
          </div>
        </>
      )}
      <div className={clsx('space-y-2 p-4', page && 'card')}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-5 rounded bg-slate-100" style={{ width: `${92 - i * 9}%` }} />)}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}

export function ErrorBanner({ error }: { error: string | null | undefined }) {
  if (!error) return null
  return <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
}

// ---------- Badge ----------

const STATUS_TONES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-sky-50 text-sky-700',
  accepted: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-red-50 text-red-700',
  expired: 'bg-orange-50 text-orange-700',
  lead: 'bg-violet-50 text-violet-700',
  planned: 'bg-sky-50 text-sky-700',
  active: 'bg-brand-100 text-brand-800',
  on_hold: 'bg-orange-50 text-orange-700',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  paid: 'bg-emerald-50 text-emerald-700',
  overdue: 'bg-red-50 text-red-700',
  unmatched: 'bg-red-50 text-red-700',
  suggested: 'bg-brand-100 text-brand-800',
  matched: 'bg-emerald-50 text-emerald-700',
  ignored: 'bg-slate-100 text-slate-500',
}

export function Badge({ children, tone, className }: { children: ReactNode; tone?: string; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', tone ?? 'bg-slate-100 text-slate-600', className)}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status]}>{labelize(status)}</Badge>
}

// ---------- Modal ----------

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  // Portalled so a modal opened from inside a <label> or form doesn't inherit its clicks/submits.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={clsx('flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', wide ? 'sm:max-w-4xl' : 'sm:max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

// ---------- Form fields ----------

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="no-print -mx-4 mb-4 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
      <nav className="flex min-w-max gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={clsx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap',
              value === t.id ? 'border-brand-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export function ProgressBar({ value, max, tone }: { value: number; max: number; tone?: 'auto' | 'accent' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const over = max > 0 && value > max
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={clsx('h-full rounded-full', over ? 'bg-red-500' : tone === 'accent' ? 'bg-brand-500' : pct > 85 ? 'bg-orange-500' : 'bg-emerald-500')}
        style={{ width: `${over ? 100 : pct}%` }}
      />
    </div>
  )
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] text-sm">{children}</table>
    </div>
  )
}

export const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200'
export const td = 'px-3 py-2.5 border-b border-slate-100 align-top'
