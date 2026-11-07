import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { countNeedsLinking, getDayPhoto, getSettings } from '../../lib/api'
import { applyBrandPhotos } from '../../lib/brandPhotos'
import { applyDayLook, johannesburgToday, lookFromRow, type DayLook } from '../../lib/dayPhotos'
import { DAY_LOOK_FALLBACK_MS, paintPlainBand, rememberDay, rememberedDay, unpaintPlainBand } from '../../lib/dayLookCache'
import type { CompanySettings } from '../../types'

interface BuildContextValue {
  settings: CompanySettings | null
  reloadSettings: () => void
  /** Bank lines still waiting to be linked (sidebar badge, dashboard card). */
  needsLinking: number
  refreshNeedsLinking: () => void
  /** Today's photo of the day (Remus · Handover 8): the approved look, or the band's chosen photograph. */
  dayLook: DayLook | null
}

const Ctx = createContext<BuildContextValue | null>(null)

export function BuildProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<CompanySettings | null>(null)
  const [needsLinking, setNeedsLinking] = useState(0)
  /*
   * NO FLASH OF YESTERDAY'S PHOTOGRAPH (Raptor S18, copied in Remus · Handover 8 -- lib/dayLookCache.ts). Before the
   * first paint: today's answer as this device last read it, or, the first visit of the day, a plain band until the
   * answer is in. The initialiser runs once, before anything under this provider is drawn.
   */
  const [dayLook, setDayLook] = useState<DayLook | null>(() => {
    if (typeof document === 'undefined') return null
    const seen = rememberedDay(johannesburgToday())
    if (!seen) { paintPlainBand(); return null }
    applyBrandPhotos(seen.choice)
    const look = lookFromRow(seen.row, seen.choice)
    applyDayLook(look)
    return look
  })

  const reloadSettings = useCallback(() => {
    // The settings and today's photo of the day are asked for together and put on the page once BOTH are in: the
    // chosen photographs (lib/brandPhotos.ts), then today's approved look over them (lib/dayPhotos.ts). Applying the
    // chosen one first and the day's a round trip later was the flash.
    const day = johannesburgToday()
    Promise.all([getSettings(), getDayPhoto(day).then((row) => ({ row, ok: true }), () => ({ row: null, ok: false }))])
      .then(([s, { row, ok }]) => {
        setSettings(s)
        applyBrandPhotos(s.brand_photos)
        const look = lookFromRow(row, s.brand_photos)
        applyDayLook(look)
        setDayLook(look)
        if (ok) rememberDay(day, row, s.brand_photos ?? null)
      }).catch(() => {})
  }, [])
  const refreshNeedsLinking = useCallback(() => {
    countNeedsLinking().then(setNeedsLinking).catch(() => {})
  }, [])

  useEffect(() => {
    reloadSettings()
    refreshNeedsLinking()
  }, [reloadSettings, refreshNeedsLinking])
  /* No answer in four seconds: the photographs as they always were, never a bare band all day (lib/dayLookCache.ts). */
  useEffect(() => {
    if (dayLook) return
    const t = window.setTimeout(unpaintPlainBand, DAY_LOOK_FALLBACK_MS)
    return () => window.clearTimeout(t)
  }, [dayLook])

  return <Ctx.Provider value={{ settings, reloadSettings, needsLinking, refreshNeedsLinking, dayLook }}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react/only-export-components
export function useBuild() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useBuild must be used within BuildProvider')
  return v
}

/**
 * The VAT rate to charge and to split slips at: the company's rate, 15% until settings load, and
 * 0 while the company is not registered for VAT (nothing is charged, and a slip's full amount is
 * the cost because its VAT cannot be claimed back).
 */
// eslint-disable-next-line react/only-export-components
export function useVatRate(): number {
  const s = useBuild().settings
  if (s && !s.vat_registered) return 0
  return s?.vat_rate ?? 15
}
