/**
 * When each stage of a quote starts, for the PDF's estimated timeline.
 *
 * A copy of scheduleStages in src/lib/quoteMath.ts, because api/ cannot import from src/ (the
 * functions are built separately). src/lib/quoteSchedule.test.ts runs both on the same plans, so
 * the PDF and the screen cannot drift apart.
 */
export interface StageRow {
  name: string
  duration_days: number
  start_mode: 'start' | 'with' | 'after'
  start_ref: string | null
  lag_days: number
}

export interface ScheduledRow extends StageRow {
  startDay: number
  endDay: number
}

export function scheduleStageRows(stages: StageRow[]): { stages: ScheduledRow[]; totalDays: number } {
  const out: ScheduledRow[] = []
  for (const [i, st] of stages.entries()) {
    const dur = Math.max(0, Math.round(Number(st.duration_days) || 0))
    const lag = Math.round(Number(st.lag_days) || 0)
    const ref = (st.start_ref !== null ? out.find((x) => x.name === st.start_ref) : undefined) ?? out[i - 1]
    let start = 0
    if (st.start_mode === 'start' || !ref) start = Math.max(0, lag)
    else if (st.start_mode === 'with') start = ref.startDay + lag
    else start = ref.endDay + lag
    start = Math.max(0, start)
    out.push({ ...st, duration_days: dur, startDay: start, endDay: start + dur })
  }
  return { stages: out, totalDays: out.reduce((m, s) => Math.max(m, s.endDay), 0) }
}
