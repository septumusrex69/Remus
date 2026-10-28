import { clsx } from 'clsx'
import type { JobScore } from '../../../lib/jobScore'

/**
 * THE BUDGET BAR (Remus · Handoff 5). Stephan: "a little bar that shows us over or under budget ... how
 * far we are in that progress."
 *
 * The fill is the share of the quoted cost spent; the dark line across the track is the budget itself,
 * so a fill running past it is over budget and reads at a glance; the small marker is how much of the
 * job's time has gone -- a fill well past the marker is spending ahead of the work. Colour follows
 * scoreJob's verdict (green on budget, amber nearing or ahead of the work, red over). Percentages only,
 * so it is the same bar for an Administrator and a contractor (lib/access.ts).
 */
const SCALE = 125 // the track runs to 125% of the budget, so up to a quarter over still shows as over
const FILL: Record<JobScore['tone'], string> = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', neutral: 'bg-slate-400' }

export function BudgetBar({ score, compact }: { score: Pick<JobScore, 'costPct' | 'timePct' | 'tone'>; compact?: boolean }) {
  const used = score.costPct
  if (used == null) return null
  const at = (pct: number) => `${(Math.min(pct, SCALE) / SCALE) * 100}%`
  const diff = used - 100
  const words = diff > 0 ? `${diff}% over budget` : diff === 0 ? 'exactly on budget' : `${-diff}% of the budget left`
  return (
    <div className={compact ? 'mt-1.5 w-full max-w-56' : 'w-full'} data-testid="budget-bar"
      title={`${used}% of the budget used${score.timePct != null ? `, ${score.timePct}% of the time gone` : ''}`}>
      {!compact && (
        <div className="mb-1 flex justify-between gap-2 text-xs">
          <span className="text-slate-500">Budget used <span className="tabular font-semibold text-slate-800">{used}%</span>{score.timePct != null && <> · <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-slate-700 bg-white align-[-1px]" /> time gone <span className="tabular font-semibold text-slate-800">{score.timePct}%</span></>}</span>
          <span className={clsx('font-medium', diff > 0 ? 'text-red-700' : 'text-emerald-700')}>{words}</span>
        </div>
      )}
      <div className={clsx('relative w-full rounded-full bg-slate-100', compact ? 'h-1.5' : 'h-3')}>
        <div className={clsx('absolute inset-y-0 left-0 rounded-full', FILL[score.tone])} style={{ width: at(used) }} />
        {/* The budget: everything to the right of this line is over. */}
        <div className="absolute -inset-y-1 w-0.5 rounded bg-slate-800" style={{ left: at(100) }} />
        {/* How much of the job's time has gone. */}
        {score.timePct != null && (
          <div className={clsx('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-700 bg-white', compact ? 'h-2.5 w-2.5' : 'h-4 w-4')} style={{ left: at(score.timePct) }} />
        )}
      </div>
      {!compact && (
        <div className="relative mt-1 h-3 text-[10px] text-slate-400">
          <span className="absolute -translate-x-1/2" style={{ left: at(100) }}>Budget</span>
        </div>
      )}
    </div>
  )
}
