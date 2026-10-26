import { Card } from '../../../components/ui'
import { describeDuration, type ScheduledStage, type StagePlan } from '../../../lib/quoteMath'

/**
 * Planning the job from the quote (Stephan, 25 Oct 2026): "the bathroom is going to take 2 days,
 * the basin another 2 days, we start the basin 1 day after the bathroom", and see how long the
 * whole job takes. Each section of the quote is a stage.
 *
 * The controls live here, beside the timeline they move, and not under each section of the line
 * items: there they made the pricing screen read as "very confusing and like a lot" (26 Oct).
 */

const stageLabel = (name: string) => name || 'General'

/** How long a stage takes and when it starts, in one short line. */
function StageControls({
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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-slate-500">
      <input
        className="input w-14 px-1.5 py-1 text-right text-xs"
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={stage.duration_days}
        onChange={(e) => onChange({ duration_days: e.target.value === '' ? 0 : Math.max(0, Math.round(Number(e.target.value))) })}
        aria-label={`Working days for ${stageLabel(stage.name)}`}
      />
      <span>day{Number(stage.duration_days) === 1 ? '' : 's'},</span>
      <select
        className="input w-auto max-w-[14rem] px-1.5 py-1 text-xs"
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'start') onChange({ start_mode: 'start', start_ref: null })
          else {
            const [mode, ...rest] = v.split(':')
            onChange({ start_mode: mode as 'with' | 'after', start_ref: rest.join(':') })
          }
        }}
        aria-label={`When ${stageLabel(stage.name)} starts`}
      >
        <option value="start">starts on day 1</option>
        {earlier.map((n) => (
          <option key={`after:${n}`} value={`after:${n}`}>starts after {stageLabel(n)}</option>
        ))}
        {earlier.map((n) => (
          <option key={`with:${n}`} value={`with:${n}`}>starts with {stageLabel(n)}</option>
        ))}
      </select>
      {/* Only offered once the stage hangs off another; "-1" overlaps by a day. */}
      {value !== 'start' && (
        <label className="inline-flex items-center gap-1" title="Days later; a minus number overlaps (-1 starts a day earlier).">
          +
          <input
            className="input w-12 px-1.5 py-1 text-right text-xs"
            type="number"
            inputMode="numeric"
            step={1}
            value={stage.lag_days}
            onChange={(e) => onChange({ lag_days: e.target.value === '' ? 0 : Math.round(Number(e.target.value)) })}
            aria-label="Days later"
          />
          days
        </label>
      )}
    </div>
  )
}

/** The stages, each with its days and start, on a timeline; and how long the whole job takes. */
export function QuotePlanCard({
  stages,
  totalDays,
  onChange,
}: {
  stages: ScheduledStage[]
  totalDays: number
  onChange: (name: string, p: Partial<StagePlan>) => void
}) {
  const days = Math.max(totalDays, 1)
  // A label on every day for a short job, every 5th on a long one, so they never crowd.
  const every = days <= 15 ? 1 : days <= 40 ? 5 : 10
  return (
    <Card title="Plan" subtitle={`How long the job takes: ${describeDuration(totalDays)}. For you only; not on the quote.`}>
      {stages.length === 0 ? (
        <p className="text-sm text-slate-500">Add lines to the quote; each section becomes a stage of the work.</p>
      ) : (
        <div className="space-y-3">
          {stages.map((s, i) => (
            <div key={s.name}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-slate-800">{stageLabel(s.name)}</span>
                <StageControls stage={s} earlier={stages.slice(0, i).map((x) => x.name)} onChange={(p) => onChange(s.name, p)} />
              </div>
              <div className="relative h-6 rounded bg-slate-100">
                {/* Day lines, so a one-day overlap is visible. */}
                {Array.from({ length: days - 1 }, (_, d) => (
                  <span key={d} className="absolute inset-y-0 w-px bg-white/80" style={{ left: `${((d + 1) / days) * 100}%` }} />
                ))}
                {s.duration_days > 0 && (
                  <div
                    className="absolute inset-y-0.5 flex items-center overflow-hidden rounded bg-brand-500 px-1.5 text-[11px] font-medium whitespace-nowrap text-white"
                    style={{ left: `${(s.startDay / days) * 100}%`, width: `${(s.duration_days / days) * 100}%` }}
                    title={`Day ${s.startDay + 1} to day ${s.endDay}`}
                  >
                    Day {s.startDay + 1}{s.duration_days > 1 ? `–${s.endDay}` : ''}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="relative h-4 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            {Array.from({ length: days }, (_, d) =>
              d % every === 0 ? (
                <span key={d} className="absolute" style={{ left: `${(d / days) * 100}%` }}>
                  Day {d + 1}
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
