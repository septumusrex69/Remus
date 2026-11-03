import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { countNeedsLinking, getDayPhoto, getSettings } from '../../lib/api'
import { applyBrandPhotos } from '../../lib/brandPhotos'
import { applyDayLook, johannesburgToday, lookFromRow, type DayLook } from '../../lib/dayPhotos'
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
  const [dayLook, setDayLook] = useState<DayLook | null>(null)

  const reloadSettings = useCallback(() => {
    // The chosen photographs go on the page as soon as the settings are read (lib/brandPhotos.ts).
    // Then today's photo of the day over it, if an Administrator approved one (lib/dayPhotos.ts).
    getSettings().then(async (s) => {
      setSettings(s)
      applyBrandPhotos(s.brand_photos)
      const row = await getDayPhoto(johannesburgToday()).catch(() => null)
      const look = lookFromRow(row, s.brand_photos)
      applyDayLook(look)
      setDayLook(look)
    }).catch(() => {})
  }, [])
  const refreshNeedsLinking = useCallback(() => {
    countNeedsLinking().then(setNeedsLinking).catch(() => {})
  }, [])

  useEffect(() => {
    reloadSettings()
    refreshNeedsLinking()
  }, [reloadSettings, refreshNeedsLinking])

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
