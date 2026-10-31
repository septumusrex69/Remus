import { clsx } from 'clsx'

/**
 * THE PROGRESS DIAL (Remus · Handover 6). Stephan sent a time-tracker ring: "we can use it for ... project progress.
 * So full circle is 100% ... sometimes it could be like a straight line, sometimes it could be like this."
 *
 * A thick arc from twelve o'clock for what is done, fine ticks round the rest for what is still to do, and the
 * figure in the middle. The arc takes the text colour (Steel under Platinum, `text-emerald-500`), so a caller can
 * colour it by meaning. ProgressLine is the same thing straight.
 */
const TICKS = 60

export function ProgressDial({ value, label, size = 140, className, toneClass = 'text-emerald-500' }: {
  /** 0-100, or null when there is nothing to measure. */
  value: number | null
  /** Under the figure: "done", "by the plan". */
  label?: string
  size?: number
  className?: string
  toneClass?: string
}) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  const c = 50
  const small = size < 90
  const r = small ? 42 : 40
  const len = 2 * Math.PI * r
  return (
    <div className={clsx('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}
      role="img" aria-label={value == null ? 'No progress figure yet' : `${v}% ${label ?? 'done'}`} data-testid="progress-dial">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
        {/* What is still to do: fine ticks round the rest of the ring. */}
        {Array.from({ length: TICKS }, (_, i) => {
          const at = (i / TICKS) * 100
          if (value != null && at < v + 2) return null
          const a = (i / TICKS) * 2 * Math.PI
          return <line key={i} x1={c + Math.cos(a) * (r - 4)} y1={c + Math.sin(a) * (r - 4)} x2={c + Math.cos(a) * (r + 4)} y2={c + Math.sin(a) * (r + 4)}
            className="stroke-slate-300" strokeWidth={small ? 1.6 : 1.1} strokeLinecap="round" />
        })}
        {/* What is done: one thick arc from twelve o'clock. */}
        {value != null && v > 0 && (
          <circle cx={c} cy={c} r={r} fill="none" className={clsx('stroke-current', toneClass)} strokeWidth={small ? 8 : 8.5}
            strokeLinecap="round" strokeDasharray={`${(v / 100) * len} ${len}`} />
        )}
      </svg>
      {/* Sized to the ring's hole (Stephan: "91% ... over the line of the block ... looks pretty shitty"): the figure
          is a share of the dial's width, the % sign smaller, so it never reaches the arc. */}
      <span className="relative text-center leading-none">
        <span className="tabular block font-semibold tracking-tight text-slate-900" style={{ fontSize: Math.round(size * (small ? 0.24 : 0.21)) }}>
          {value == null ? '—' : <>{v}<span style={{ fontSize: '0.62em', marginLeft: '0.04em' }}>%</span></>}
        </span>
        {label && !small && <span className="mt-1 block text-[11px] text-slate-500">{label}</span>}
      </span>
    </div>
  )
}

/** The dial straight: a thick bar for what is done, ticks for what is left. */
export function ProgressLine({ value, className, toneClass = 'bg-emerald-500' }: { value: number | null; className?: string; toneClass?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <span className={clsx('relative block h-2 w-full', className)} data-testid="progress-line">
      <span className="absolute inset-0 rounded-full" style={{ backgroundImage: 'repeating-linear-gradient(90deg, var(--color-slate-300) 0 1.5px, transparent 1.5px 6px)', backgroundSize: '100% 60%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />
      <span className={clsx('absolute inset-y-0 left-0 rounded-full', toneClass)} style={{ width: `${v}%` }} />
    </span>
  )
}
