import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ImageOff } from 'lucide-react'
import { useAccess } from '../../../lib/access'
import { photoUrl } from '../../../lib/brandPhotos'
import { johannesburgToday } from '../../../lib/dayPhotos'
import { listDayPhotos } from '../../../lib/api'
import { useBuild } from '../BuildContext'
import { paths } from '../paths'

/**
 * REMUS'S PHOTOGRAPHS, ON AN ADMINISTRATOR'S DASHBOARD (Remus · Handover 8), copied from Raptor S16's PortalPhotoAlert.
 * Two things an Administrator must hear, and nothing at all when both are fine -- a warning that is always there is
 * a warning nobody reads.
 *  1. UNSPLASH IS OFF: today's photograph is asked for at a tiny size; if it does not come within ten seconds, say so.
 *     (The bell's line comes from the server's own morning check, api/_lib/photoCheck.ts, once a day.)
 *  2. DAYS NOBODY APPROVED in the coming week, once a month has been planned at /photo-days: those days show the
 *     standard photographs, so the dashboard says how many and links to the planner.
 */
const AHEAD = 7

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function PhotoAlert() {
  const admin = useAccess() === 'admin'
  const { dayLook } = useBuild()
  const [down, setDown] = useState(false)
  const [unapproved, setUnapproved] = useState(0)

  useEffect(() => {
    if (!admin || !dayLook || typeof Image === 'undefined') return
    let live = true
    const img = new Image()
    const timer = setTimeout(() => { if (live) setDown(true) }, 10_000)
    img.onload = () => { clearTimeout(timer); if (live) setDown(false) }
    img.onerror = () => { clearTimeout(timer); if (live) setDown(true) }
    img.src = photoUrl(dayLook.photo, 64)
    return () => { live = false; clearTimeout(timer) }
  }, [admin, dayLook])

  useEffect(() => {
    if (!admin) return
    let live = true
    const today = johannesburgToday()
    // Only once the firm uses the planner: a week with no rows at all is a firm that has not started, not a gap.
    listDayPhotos(today, addDays(today, AHEAD - 1)).then((rows) => {
      if (!live) return
      const anyPlanned = rows.length > 0
      setUnapproved(anyPlanned ? AHEAD - rows.filter((r) => r.approved_at).length : 0)
    }).catch(() => {})
    return () => { live = false }
  }, [admin])

  if (!admin || (!down && unapproved === 0)) return null
  return (
    <div className="space-y-2">
      {down && (
        <div role="status" data-testid="photo-alert" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ImageOff size={18} className="mt-0.5 shrink-0" />
          <p><b>Unsplash is not serving Remus's photographs</b> right now, so the dashboard band and the sign-in are plain dark. Nothing else is affected, and they come back by themselves when Unsplash does.</p>
        </div>
      )}
      {unapproved > 0 && (
        <div role="status" data-testid="photo-days-alert" className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <CalendarClock size={18} className="mt-0.5 shrink-0 text-slate-500" />
          <p className="flex-1"><b>{unapproved === 1 ? '1 day' : `${unapproved} days`} in the next week</b> {unapproved === 1 ? 'has' : 'have'} no approved photo of the day, so {unapproved === 1 ? 'it shows' : 'they show'} the standard photographs.</p>
          <Link to={paths.photoDays()} className="shrink-0 font-medium text-brand-700 hover:underline">Approve the month</Link>
        </div>
      )}
    </div>
  )
}
