import { CalendarRange } from 'lucide-react'
import { Card } from '../../../components/ui'
import { describeDuration, type ScheduledStage, type StagePlan } from '../../../lib/quoteMath'

/**
 * Planning the job from the quote (Stephan, 25 Oct 2026): "the bathroom is going to take 2 days,
 * the basin another 2 days, we start the basin 1 day after the bathroom", and see how long the
 * whole job takes. Each section of the quote is a stage; these are its controls and the timeline.
 */

const stageLabel = (name: string) => name || 'General'

/** Under a section's heading: how long it takes and when it starts. */
export function StageControls({
  stage,
  earlier,
  onChange,
}: {
  stage: StagePlan
  /** Names of the stages above this one: the only ones it can hang off, so there are no loops. */
  earlier: string[]
  onChange: (p: Partial<StagePlan>) => void
}) {
  // The select's value: 'start', or the mode and the stage it hangs off.
  const ref = stage.start_ref ?? earlier[earlier.length - 1] ?? null
  const value = stage.start_mode === 'start' || ref === null ? 'start' : `${stage.start_mode}:${ref}`
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-2 pt-1 text-xs text-slate-500">
      <CalendarRange size={13} className="text-slate-400" />
      <label className="inline-flex items-center gap-1.5">
        Takes
        <input
          className="input w-14 px-1.5 py-1 text-right text-xs"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={stage.duration_days}
          onChange={(e) => onChange({ duration_days: e.target.value === '' ? 0 : Math.max(0, Math.round(Number(e.target.value))) })}
          aria-label="Working days"
        />
        working day{Number(stage.duration_days) === 1 ? '' : 's'}
      </label>
      <label className="inline-flex items-center gap-1.5">
        Starts
        <select
          className="input w-auto max-w-[15rem] px-1.5 py-1 text-xs"
          value={value}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'start') onChange({ start_mode: 'start', start_ref: null })
            else {
              const [mode, ...rest] = v.split(':')
              onChange({ start_mode: mode as 'with' | 'after', start_ref: rest.join(':') })
            }
          }}
        >
          <option value="start">at the beginning of the job</option>
          {earlier.map((n) => (
            <option key={`after:${n}`} value={`after:${n}`}>after {stageLabel(n)} finishes</option>
          ))}
          {earlier.map((n) => (
            <option key={`with:${n}`} value={`with:${n}`}>when {stageLabel(n)} starts</option>
          ))}
        </select>
      </label>
      <label className="inline-flex items-center gap-1.5" title="Use a minus number to overlap: -1 starts a day before.">
        +
        <input
          className="input w-14 px-1.5 py-1 text-right text-xs"
          type="number"
          inputMode="numeric"
          step={1}
          value={stage.lag_days}
          onChange={(e) => onChange({ lag_days: e.target.value === '' ? 0 : Math.round(Number(e.target.value)) })}
          aria-label="Days later"
        />
        days
      </label>
    </div>
  )
}

/** The stages on a timeline, day by day, and how long the whole job takes. */
export function QuotePlanCard({ stages, totalDays }: { stages: ScheduledStage[]; totalDays: number }) {
  const days = Math.max(totalDays, 1)
  // A label on every day for a short job, every 5th on a long one, so they never crowd.
  const every = days <= 15 ? 1 : days <= 40 ? 5 : 10
  return (
    <Card title="Plan" subtitle={`How long the job takes: ${describeDuration(totalDays)}. Internal; not on the quote.`}>
      {stages.length === 0 ? (
        <p className="text-sm text-slate-500">Add lines to the quote; each section becomes a stage of the work.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[28rem]">
            <div className="grid grid-cols-[8rem_1fr] items-end gap-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              <span>Stage</span>
              <div className="relative h-4">
                {Array.from({ length: days }, (_, d) =>
                  d % every === 0 ? (
                    <span key={d} className="absolute" style={{ left: `${(d / days) * 100}%` }}>
                      Day {d + 1}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
            {stages.map((s) => (
              <div key={s.name} className="grid grid-cols-[8rem_1fr] items-center gap-2 py-1">
                <span className="truncate text-sm text-slate-700" title={stageLabel(s.name)}>{stageLabel(s.name)}</span>
                <div className="relative h-7 rounded bg-slate-50">
                  {/* Day lines, so a one-day overlap is visible. */}
                  {Array.from({ length: days - 1 }, (_, d) => (
                    <span key={d} className="absolute inset-y-0 w-px bg-slate-200/70" style={{ left: `${((d + 1) / days) * 100}%` }} />
                  ))}
                  {s.duration_days > 0 ? (
                    <div
                      className="absolute inset-y-1 flex items-center overflow-hidden rounded bg-brand-500 px-1.5 text-[11px] font-medium whitespace-nowrap text-white"
                      style={{ left: `${(s.startDay / days) * 100}%`, width: `${(s.duration_days / days) * 100}%` }}
                      title={`Day ${s.startDay + 1} to day ${s.endDay}`}
                    >
                      {s.duration_days}d
                    </div>
                  ) : (
                    <span className="absolute inset-y-0 flex items-center pl-1 text-[11px] text-slate-400" style={{ left: `${(s.startDay / days) * 100}%` }}>
                      0 days
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
