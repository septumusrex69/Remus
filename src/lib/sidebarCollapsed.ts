import { useCallback, useEffect, useState } from 'react'

/**
 * Whether a pane is folded down to an icon rail. Copied from Raptor (src/lib/sidebarCollapsed.ts).
 *
 * Remembered per device in localStorage, not in the profile: it is about the screen somebody is
 * sitting at, and the same person on a phone and a desktop wants different answers. Shared through
 * a window event so every reader updates together without re-rendering the whole app.
 */
const CHANGED = (key: string) => `remus:collapsed:${key}`

function read(key: string): boolean {
  // Storage can be blocked outright in a private window, and the default is still the right
  // answer — a pane that fails to open is worse than one that fails to remember.
  try { return window.localStorage.getItem(key) === '1' } catch { return false }
}

/** Whether the pane stored under `key` is folded, and a toggle for it. */
export function useCollapsed(key: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => read(key))

  useEffect(() => {
    /* Re-read on the way in as well as on the event: the key can change between renders, and a
       hook that only listened would show the previous pane's answer until something moved. */
    setCollapsed(read(key))
    const onChanged = () => setCollapsed(read(key))
    window.addEventListener(CHANGED(key), onChanged)
    /* Another tab folding its nav should not fold this one's — but coming BACK to a tab that has
       been open for a day and finding it disagrees with every other tab is worse. */
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener(CHANGED(key), onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [key])

  const toggle = useCallback(() => {
    const next = !read(key)
    try { window.localStorage.setItem(key, next ? '1' : '0') } catch { /* not worth an error */ }
    window.dispatchEvent(new Event(CHANGED(key)))
  }, [key])

  return [collapsed, toggle]
}

/** The main menu. */
export function useSidebarCollapsed(): [boolean, () => void] {
  return useCollapsed('remus.sidebar.collapsed')
}
