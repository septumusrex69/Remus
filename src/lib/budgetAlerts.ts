/**
 * TELLING THE BELL (Remus · Handover 6). A job's spend is worked out in the browser (lib/projectScores.ts), so
 * the screens that score jobs -- the dashboard, the Projects list, a project's page -- pass each running job's
 * level on here, and the database (remus_budget_alert, migration 0031) notifies the Administrators and
 * contractors ONCE per level per job. Asked at most once per job and level per visit; a failure is quiet (the
 * colours on screen still say it).
 */
import { supabase } from './supabase'
import { budgetAlertLevel } from './budgetLevel'
import { refreshNotifications } from './notifications'

const asked = new Set<string>()

export function reportBudgetLevels(jobs: { id: string; status: string; costPct: number | null }[]): void {
  for (const j of jobs) {
    if (j.status !== 'active' && j.status !== 'on_hold') continue
    const level = budgetAlertLevel(j.costPct)
    if (!level) continue
    const key = `${j.id}:${level}`
    if (asked.has(key)) continue
    asked.add(key)
    void supabase.rpc('remus_budget_alert', { p_project: j.id, p_level: level, p_pct: Math.round(j.costPct ?? 0) })
      .then(({ data, error }) => {
        if (error) console.warn('[budget alert]', error.message)
        else if (data === true) void refreshNotifications()
      })
  }
}
