import { clsx } from 'clsx'
import type { JobScore } from '../../../lib/jobScore'
import { budgetColour, type BudgetColour } from '../../../lib/budgetLevel'

/**
 * THE BUDGET BAR (Remus · Handoff 5). Stephan: "a little bar that shows us over or under budget ... how
 * far we are in that progress."
 *
 * The fill is the share of the quoted cost spent; the dark line across the track is the budget itself,
 * so a fill running past it is over budget and reads at a glance; the small marker is how much of the
 * job's time has gone -- a fill well past the marker is spending ahead of the work. Colour (Remus · Handover 6,
 * lib/budgetLevel.ts): green, yellow from 75% of the budget used, red from 90%. Percentages only,
 * so it is the same bar for an Administrator and a contractor (lib/access.ts).
 */
const SCALE = 125 // the track runs to 125% of the budget, so up to a quarter over still shows as over
const FILL: Record<BudgetColour, string> = { green: 'bg-emerald-500', yellow: 'bg-amber-400', red: 'bg-red-500', grey: 'bg-slate-400' }
const WORDS: Record<BudgetColour, string> = { green: 'text-emerald-700', yellow: 'text-amber-700', red: 'text-red-700', grey: 'text-slate-500' }

export function BudgetBar({ score, compact, running = true }: {
  score: Pick<JobScore, 'costPct' | 'timePct' | 'tone'>
  compact?: boolean
  /** A finished job keeps its verdict's colour (lib/budgetLevel.ts). */
  running?: boolean
}) {
  const used = score.costPct
  if (used == null) return null
  const colour = budgetColour(score, running)
  const at = (pct: number) => `${(Math.min(pct, SCALE) / SCALE) * 100}%`
  const diff = used - 100
  const words = diff > 0 ? `${diff}% over budget` : diff === 0 ? 'exactly on budget' : `${-diff}% of the budget left`
  return (
    <div className={compact ? 'mt-1.5 w-full max-w-56' : 'w-full'} data-testid="budget-bar"
      title={`${used}% of the budget used${score.timePct != null ? `, ${score.timePct}% of the time gone` : ''}`}>
      {!compact && (
        <div className="mb-1 flex justify-between gap-2 text-xs">
          <span className="text-slate-500">Budget used <span className="tabular font-semibold text-slate-800">{used}%</span>{score.timePct != null && <> · <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-slate-700 bg-white align-[-1px]" /> time gone <span className="tabular font-semibold text-slate-800">{score.timePct}%</span></>}</span>
          <span className={clsx('font-medium', WORDS[colour])}>{words}</span>
        </div>
      )}
      <div className={clsx('relative w-full rounded-full bg-slate-100', compact ? 'h-1.5' : 'h-3')}>
        <div className={clsx('absolute inset-y-0 left-0 rounded-full', FILL[colour])} style={{ width: at(used) }} />
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
