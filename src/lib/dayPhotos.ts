/**
 * THE PHOTO OF THE DAY, APPROVED A MONTH AT A TIME (Remus · Handover 8, 3 Nov 2026), copied from Raptor's portal
 * (Raptor S16: src/lib/portalPhotos.ts, /portal-looks, table portal_day_looks). Stephan, offered it from Raptor:
 * "a photo of the day ... Like for the whole month. That's cool. I like that."
 *
 * A LOOK is one of Remus's black-and-white photographs (lib/brandPhotos.ts) PLUS how it is shown: where it is framed
 * in the wide dashboard band and in the tall sign-in panel, and a line to go with it. An Administrator lays out a
 * month at /photo-days (Remus fills it from the rotation, they change what they like) and approves it.
 *
 * ONLY AN APPROVED DAY IS SHOWN. A day nobody approved shows the photographs chosen on /photos, as before, so nothing
 * unchecked reaches the screen. lookFromRow is the one place that decides it.
 *
 * DIFFERENT FROM RAPTOR: no "which side the words sit" and no shade setting -- Remus's band always has its words on
 * the left under the same black glass (skins.css), so framing is all there is to choose. And the lines are about
 * building, not South Africa. Platinum Night keeps its drawing in the band (Stephan picked the contours); the sign-in
 * follows the photo of the day under every skin that shows a photograph there.
 */
import { BRAND_PHOTOS, photoById, photoFor, photoUrl, type BrandPhoto, type BrandPhotoChoice } from './brandPhotos'

/*
 * THE LINES. The firm's own lines carry no name. ONLY QUOTES ON GOOD AUTHORITY (Raptor's rule: the internet credits a
 * great deal to people who never said it): Wotton's "commodity, firmness and delight" (The Elements of Architecture,
 * 1624); Churchill on shaping buildings (House of Commons, 28 Oct 1943); Sullivan's "form ever follows function" (The
 * Tall Office Building Artistically Considered, 1896); Le Corbusier's "learned game" (Towards a New Architecture, 1923).
 */
export const DAY_LINES: { line: string; who?: string }[] = [
  { line: 'A straight wall starts with a straight first course.' },
  { line: 'Well building hath three conditions: commodity, firmness and delight.', who: 'Sir Henry Wotton, 1624' },
  { line: 'Measure twice, cut once.', who: 'The builder’s rule' },
  { line: 'Good foundations never get photographed. They just hold everything up.' },
  { line: 'We shape our buildings; thereafter they shape us.', who: 'Winston Churchill, 1943' },
  { line: 'A clean site is a safe site, and a safe site is a fast one.' },
  { line: 'Every slip filed today is one less question at month end.' },
  { line: 'Form ever follows function.', who: 'Louis Sullivan, 1896' },
  { line: 'The client remembers the finish. The house remembers the foundation.' },
  { line: 'Plan the work, then work the plan.' },
  { line: 'Architecture is the learned game, correct and magnificent, of forms assembled in the light.', who: 'Le Corbusier, 1923' },
  { line: 'Concrete forgives nothing. Check the shuttering twice.' },
  { line: 'A good crew is built the same way as a good wall: one course at a time.' },
  { line: 'On budget is a habit, not an accident.' },
  { line: 'Leave every site better than you found it.' },
  { line: 'The level does not lie. Trust it.' },
  { line: 'Quality is remembered long after the price is forgotten.' },
  { line: 'Small daily progress builds big houses.' },
  { line: 'Call the client before the client calls you.' },
  { line: 'Square, plumb and level. Everything else follows.' },
  { line: 'Tools cleaned tonight are tools ready tomorrow.' },
  { line: 'Snag lists get shorter when the work is done right the first time.' },
  { line: 'Steel, sand, cement and people. Look after all four.' },
  { line: 'A job well set out is half built.' },
  { line: 'Build it as if your own family will live in it.' },
  { line: 'The weather does not wait. Neither should the order for materials.' },
  { line: 'Strong walls, honest prices, clean handovers.' },
  { line: 'Every big project is a lot of small jobs done properly.' },
  { line: 'Take back what you did not use. Money in the bakkie is not money in the bank.' },
  { line: 'Finish strong. The last coat is the one they see.' },
  { line: 'Proud work, every day.' },
]

/** Days count from 1 Nov 2026, the first month of photos of the day. */
const START = Date.UTC(2026, 10, 1)

const daysSinceStart = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - START) / 86_400_000)
}
const at = <T,>(list: T[], n: number) => list[((n % list.length) + list.length) % list.length]

/** The rotation's photograph for a day: every photograph before any repeats, the same for everybody. */
export function photoOfTheDay(day: string): BrandPhoto {
  return at(BRAND_PHOTOS, daysSinceStart(day))
}
export function lineOfTheDay(day: string): { line: string; who?: string } {
  return at(DAY_LINES, daysSinceStart(day))
}

/** A moment's day in Johannesburg, yyyy-mm-dd: the day the photograph changes at midnight. */
export function johannesburgToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Every day of a month ('2026-11'), yyyy-mm-dd. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** The month after ('2026-12' after '2026-11'). */
export function nextMonth(month: string, by = 1): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** One row of public.day_photos (migration 0037). */
export interface DayPhotoRow {
  day: string
  photo_id: string
  band_x: number
  band_y: number
  login_x: number
  login_y: number
  line: string | null
  who: string | null
  approved_at: string | null
  approved_by?: string | null
}

export interface DayLook {
  photo: BrandPhoto
  band: { x: number; y: number }
  login: { x: number; y: number }
  line: string | null
  who: string | null
  approved: boolean
}

/** A fresh, unapproved day: the rotation's photograph and line, framed as the band has always framed it. */
export function draftRowFor(day: string): DayPhotoRow {
  const l = lineOfTheDay(day)
  return { day, photo_id: photoOfTheDay(day).id, band_x: 50, band_y: 62, login_x: 50, login_y: 50, line: l.line, who: l.who ?? null, approved_at: null }
}

const pct = (n: unknown, d: number) => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : d
}

/**
 * What a day shows: its row if APPROVED and naming a photograph we have; otherwise the photographs chosen on /photos
 * (the band's and the sign-in's), framed as before, with no line.
 */
export function lookFromRow(row: DayPhotoRow | null | undefined, choice: BrandPhotoChoice | null | undefined, place: 'band' | 'login' = 'band'): DayLook {
  const photo = row?.approved_at ? photoById(row.photo_id) : undefined
  if (!row || !photo) {
    return { photo: photoFor(place, choice), band: { x: 50, y: 62 }, login: { x: 50, y: 50 }, line: null, who: null, approved: false }
  }
  return {
    photo,
    band: { x: pct(row.band_x, 50), y: pct(row.band_y, 62) },
    login: { x: pct(row.login_x, 50), y: pct(row.login_y, 50) },
    line: row.line?.trim() || null,
    who: row.line?.trim() ? row.who?.trim() || null : null,
    approved: true,
  }
}

/** How a month stands: days approved, days drafted but not approved, days with nothing yet. */
export function monthStatus(month: string, rows: DayPhotoRow[]): { approved: number; draft: number; empty: number } {
  const byDay = new Map(rows.map((r) => [r.day, r]))
  let approved = 0
  let draft = 0
  let empty = 0
  for (const d of monthDays(month)) {
    const r = byDay.get(d)
    if (!r) empty++
    else if (r.approved_at) approved++
    else draft++
  }
  return { approved, draft, empty }
}

/**
 * Puts an approved day's photograph in the dashboard band, framed as approved (skins.css reads --skin-photo-band and
 * --skin-photo-band-pos). Called after applyBrandPhotos, so an unapproved day leaves the chosen photograph in place.
 */
export function applyDayLook(look: DayLook): void {
  if (!look.approved) return
  const root = document.documentElement
  root.style.setProperty('--skin-photo-band', `url('${photoUrl(look.photo, 2000)}')`)
  root.style.setProperty('--skin-photo-band-pos', `${look.band.x}% ${look.band.y}%`)
  root.dataset.bandCredit = `Photo: ${look.photo.credit} / Unsplash`
}
