/**
 * GREEN, YELLOW, RED (Remus · Handover 6). Stephan: "for your budget alert when it comes close to the end of
 * the budget. Beginning with green, moving to yellow, and then red."
 *
 * A running job is yellow once 75% of its quoted cost is used and red from 90% (and over). The verdict in
 * words (lib/jobScore.ts) can make it worse, never better: spending well ahead of the calendar is yellow
 * even at 60%, an over-budget verdict is red. A finished job keeps its verdict's colour (finishing at 95%
 * is "on budget", not a warning).
 *
 * The same levels go to the bell (lib/budgetAlerts.ts -> remus_budget_alert, migration 0031), once each
 * per job: yellow, red, and over.
 */
import type { JobScore, Tone } from './jobScore'

export const BUDGET_YELLOW_PCT = 75
export const BUDGET_RED_PCT = 90

export type BudgetColour = 'green' | 'yellow' | 'red' | 'grey'
export type BudgetAlertLevel = 'yellow' | 'red' | 'over'

const RANK: Record<BudgetColour, number> = { grey: 0, green: 1, yellow: 2, red: 3 }
const FROM_TONE: Record<Tone, BudgetColour> = { good: 'green', warn: 'yellow', bad: 'red', neutral: 'grey' }

export function budgetColour(score: Pick<JobScore, 'costPct' | 'tone'>, running = true): BudgetColour {
  const byTone = FROM_TONE[score.tone]
  if (!running || score.costPct == null) return byTone
  const bySpend: BudgetColour = score.costPct >= BUDGET_RED_PCT ? 'red' : score.costPct >= BUDGET_YELLOW_PCT ? 'yellow' : 'green'
  return RANK[bySpend] >= RANK[byTone] ? bySpend : byTone
}

/** The bell's level for a running job's spend, or null below yellow. */
export function budgetAlertLevel(costPct: number | null): BudgetAlertLevel | null {
  if (costPct == null) return null
  if (costPct > 100) return 'over'
  if (costPct >= BUDGET_RED_PCT) return 'red'
  if (costPct >= BUDGET_YELLOW_PCT) return 'yellow'
  return null
}
