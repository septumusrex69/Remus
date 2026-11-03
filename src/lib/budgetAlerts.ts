/**
 * TELLING THE BELL (Remus · Handover 6). A job's spend is worked out in the browser (lib/projectScores.ts), so
 * the screens that score jobs -- the dashboard, the Projects list, a project's page -- pass each running job's
 * level on here, and the database (remus_budget_alert, migration 0031) notifies the Administrators and
 * contractors ONCE per level per job. Asked at most once per job and level per visit; a failure is quiet (the
 * colours on screen still say it).
 */
import { supabase } from './supabase'
import { budgetStep } from './budgetLevel'
import { refreshNotifications } from './notifications'

const asked = new Set<string>()

export function reportBudgetLevels(jobs: { id: string; status: string; costPct: number | null }[]): void {
  for (const j of jobs) {
    if (j.status !== 'active' && j.status !== 'on_hold') continue
    // Remus · Handover 8: at 50, 75, 90 and 100% (remus_budget_step, migration 0040).
    const step = budgetStep(j.costPct)
    if (!step) continue
    const key = `${j.id}:${step}`
    if (asked.has(key)) continue
    asked.add(key)
    void supabase.rpc('remus_budget_step', { p_project: j.id, p_step: step, p_pct: Math.round(j.costPct ?? 0) })
      .then(({ data, error }) => {
        if (error) console.warn('[budget alert]', error.message)
        else if (data === true) void refreshNotifications()
      })
  }
}
