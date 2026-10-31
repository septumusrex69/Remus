import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { countNeedsLinking, getSettings } from '../../lib/api'
import { applyBrandPhotos } from '../../lib/brandPhotos'
import type { CompanySettings } from '../../types'

interface BuildContextValue {
  settings: CompanySettings | null
  reloadSettings: () => void
  /** Bank lines still waiting to be linked (sidebar badge, dashboard card). */
  needsLinking: number
  refreshNeedsLinking: () => void
}

const Ctx = createContext<BuildContextValue | null>(null)

export function BuildProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<CompanySettings | null>(null)
  const [needsLinking, setNeedsLinking] = useState(0)

  const reloadSettings = useCallback(() => {
    // The chosen photographs go on the page as soon as the settings are read (lib/brandPhotos.ts).
    getSettings().then((s) => { setSettings(s); applyBrandPhotos(s.brand_photos) }).catch(() => {})
  }, [])
  const refreshNeedsLinking = useCallback(() => {
    countNeedsLinking().then(setNeedsLinking).catch(() => {})
  }, [])

  useEffect(() => {
    reloadSettings()
    refreshNeedsLinking()
  }, [reloadSettings, refreshNeedsLinking])

  return <Ctx.Provider value={{ settings, reloadSettings, needsLinking, refreshNeedsLinking }}>{children}</Ctx.Provider>
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
