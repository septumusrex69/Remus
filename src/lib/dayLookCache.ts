/**
 * NO FLASH OF YESTERDAY'S PHOTOGRAPH (Remus · Handover 8, 7 Nov 2026). Copied from Raptor S18's dayLookState.ts
 * (f401d23, 6 Nov). Stephan on Raptor: "the picture changes, but then for an instant it shows the old picture. And then
 * it switches to the new one." Stephan, 7 Nov, on what Raptor has that Remus does not: "We can like start with pretty
 * much all of that."
 *
 * Remus had the same flash, twice over: the dashboard band opened on skins.css's default photograph, then the one
 * chosen on /photos once the settings were read, then today's approved photo of the day a round trip later; and the
 * sign-in opened on the last chosen photograph before today's. So, as in Raptor:
 *
 *   1. TODAY'S ANSWER IS REMEMBERED ON THIS DEVICE (the day's row and the chosen photographs, keyed by the day, so
 *      yesterday's is never read as today's) and put on the page before the first paint on the next visit that day.
 *   2. UNTIL AN ANSWER IS IN, THE BAND IS PLAIN -- black glass with no photograph -- because an empty band for a moment
 *      reads as loading, and the wrong picture reads as the wrong picture. The sign-in panel likewise.
 *   3. NO ANSWER IN FOUR SECONDS: the photographs as they always were, so a slow line never leaves the band bare.
 *
 * DIFFERENT FROM RAPTOR: Raptor keeps one look in a module and paints a navy band; Remus's band is a skin's (Platinum)
 * black glass, so "plain" is simply no photograph under the same glass, and the chosen photographs (company settings)
 * are remembered with the day's row because an unapproved day shows them.
 *
 * Browser storage is a convenience here: unavailable (a private window), it simply asks, as before.
 */
import type { BrandPhotoChoice } from './brandPhotos'
import type { DayPhotoRow } from './dayPhotos'

const KEY = 'remus.dayLook'
export const DAY_LOOK_FALLBACK_MS = 4000

export interface RememberedDay {
  row: DayPhotoRow | null
  /** The photographs chosen on /photos (company_settings.brand_photos), when the settings were read; null on the sign-in. */
  choice: BrandPhotoChoice | null
}

/** Today's answer as it was last read on this device, or null when it was another day (or never). */
export function rememberedDay(day: string): RememberedDay | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as ({ day?: string } & Partial<RememberedDay>) | null
    return v && v.day === day ? { row: v.row ?? null, choice: v.choice ?? null } : null
  } catch { return null }
}

/** Keep today's answer. A sign-in visit keeps the chosen photographs a signed-in visit stored, rather than forgetting them. */
export function rememberDay(day: string, row: DayPhotoRow | null, choice?: BrandPhotoChoice | null): void {
  try {
    const keep = choice === undefined ? rememberedDay(day)?.choice ?? null : choice
    window.localStorage.setItem(KEY, JSON.stringify({ day, row, choice: keep }))
  } catch { /* nothing to remember with */ }
}

/** The band and the sidebar with no photograph, until today's answer is in (skins.css draws the glass alone). */
export function paintPlainBand(): void {
  const root = document.documentElement
  root.style.setProperty('--skin-photo-band', 'none')
  root.style.setProperty('--skin-photo-side', 'none')
  root.dataset.bandCredit = ''
}

/** No answer in time: skins.css's own photographs again, if the band is still plain (an answer since has painted it). */
export function unpaintPlainBand(): void {
  const root = document.documentElement
  for (const v of ['--skin-photo-band', '--skin-photo-side'] as const) {
    if (root.style.getPropertyValue(v) === 'none') root.style.removeProperty(v)
  }
}
