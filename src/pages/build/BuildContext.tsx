import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { countNeedsLinking, getSettings } from '../../lib/api'
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
    getSettings().then(setSettings).catch(() => {})
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

/** VAT rate from company settings, 15% until they load. */
// eslint-disable-next-line react/only-export-components
export function useVatRate(): number {
  return useBuild().settings?.vat_rate ?? 15
}
