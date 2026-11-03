import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * IS UNSPLASH SERVING REMUS'S PHOTOGRAPHS? (Remus · Handover 8), copied from Raptor S16's morning photo check
 * (api/_lib/portal.ts photoAlarm). Remus's photographs (dashboard band, sign-in, sidebar, the photo of the day) are
 * hotlinked from Unsplash, as its guidelines ask, so a day Unsplash is down they go dark. The morning cron (the
 * email sync, api/email/sync.ts) asks Unsplash for a tiny copy of one of our photographs; if it does not come, every
 * active Administrator hears it in the bell, AT MOST ONCE A DAY. The dashboard's own check (PhotoAlert) says it on
 * screen whenever an Administrator's browser cannot load today's photograph.
 *
 * One photograph stands for all of them (the grinder, lib/brandPhotos.ts's first): the question is whether Unsplash
 * answers, not whether one picture exists. The api folder cannot read src/lib, so the address is written here.
 */
const PROBE = 'https://images.unsplash.com/photo-1587370153281-c8c87fa5caf1?auto=format&fit=crop&w=64&q=50&sat=-100'
export const PHOTO_ALARM = 'photo.unsplash'

export async function unsplashServes(): Promise<{ ok: boolean; why: string }> {
  try {
    const r = await fetch(PROBE, { signal: AbortSignal.timeout(8000) })
    return r.ok ? { ok: true, why: '' } : { ok: false, why: `Unsplash answered ${r.status}` }
  } catch (e) {
    return { ok: false, why: e instanceof Error && e.name === 'TimeoutError' ? 'Unsplash did not answer within 8 seconds' : 'Unsplash could not be reached' }
  }
}

/** Rings the Administrators once a day when Unsplash is down; true when it is down. Never throws. */
export async function photoAlarm(admin: SupabaseClient): Promise<boolean> {
  try {
    const check = await unsplashServes()
    if (check.ok) return false
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const since = new Date(`${today}T00:00:00+02:00`).toISOString()
    const { count } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('type', PHOTO_ALARM).gte('created_at', since)
    if ((count ?? 0) > 0) return true
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'Administrator').eq('status', 'Active')
    const rows = (admins ?? []).map((p) => ({
      user_id: p.id as string,
      type: PHOTO_ALARM,
      message: `Remus's photographs are not loading from Unsplash: ${check.why}. The dashboard band and sign-in show plain dark until it is back.`,
      link: '/photos',
    }))
    if (rows.length) await admin.from('notifications').insert(rows)
    return true
  } catch {
    return false
  }
}
