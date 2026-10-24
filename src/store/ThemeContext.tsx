import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { THEME_STORAGE_KEY, applyTheme, readStoredTheme, storeTheme, themeById, type ThemeDefinition, type ThemeId } from '../lib/themes'

/** Copied from Raptor's src/store/ThemeContext.tsx. */
interface ThemeContextValue {
  themeId: ThemeId
  theme: ThemeDefinition
  setTheme: (id: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Read on the first render, not in an effect: a frame later would flash the other skin.
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const saved = readStoredTheme()
    applyTheme(saved)
    return saved
  })

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id)
    applyTheme(id)
    storeTheme(id)
  }, [])

  // A skin carries its own branding, and the browser tab is part of that.
  useEffect(() => {
    document.title = themeById(themeId).productName
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) icon.href = themeById(themeId).icon
  }, [themeId])

  // A second tab is the same person: switching in one carries to the others.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== THEME_STORAGE_KEY) return
      const next = readStoredTheme()
      setThemeId(next)
      applyTheme(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const value = useMemo(() => ({ themeId, theme: themeById(themeId), setTheme }), [themeId, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside a ThemeProvider')
  return ctx
}
