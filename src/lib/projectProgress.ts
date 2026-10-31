/**
 * HOW FAR ALONG A JOB IS, BY THE PLAN (Remus · Handover 6, the same sum as the client portal's
 * api/_lib/portalRules.ts projectProgress -- held equal by projectProgress.test.ts). The stages' days already behind
 * us over all their days; a finished job is 100; no dated stages, no figure rather than a made-up one.
 */
export function projectProgress(
  status: string,
  stages: { start_date: string | null; end_date: string | null }[],
  today: string,
): number | null {
  if (status === 'completed') return 100
  const dated = stages.filter((s) => s.start_date && s.end_date && s.end_date >= s.start_date)
  if (!dated.length) return null
  const day = (ymd: string) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000)
  const t = day(today)
  let total = 0
  let behind = 0
  for (const s of dated) {
    const a = day(s.start_date!)
    const len = day(s.end_date!) - a + 1
    total += len
    behind += Math.min(len, Math.max(0, t - a + 1))
  }
  return Math.round((behind / total) * 100)
}
