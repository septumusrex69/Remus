/**
 * How a person likes to read email (copied from Raptor's lib/emailView.ts).
 *
 * One preference for every surface that shows email. Somebody who thinks in a reading pane thinks
 * that way everywhere. Stored per browser, not per person: the same person on a laptop and on an
 * iPad may want different answers.
 */
import { useCallback, useEffect, useState } from 'react'

export type EmailView =
  /** Rows in one column; opening one expands it in place. */
  | 'list'
  /** Outlook's shape: the list down the left, the message you picked beside it. */
  | 'reading'

const KEY = 'remus.email.view'

/**
 * The event that keeps two switchers in step.
 *
 * `storage` only fires in OTHER tabs, so without this a page showing the switcher twice — or a
 * page and a panel — would have one of them stuck showing the old choice until a reload.
 */
const CHANGED = 'remus:email-view'

export function storedEmailView(): EmailView {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'list' || saved === 'reading') return saved
  } catch { /* private window, or storage switched off. The default is fine. */ }
  return 'list'
}

export function useEmailView(): [EmailView, (next: EmailView) => void] {
  const [view, setView] = useState<EmailView>(storedEmailView)

  useEffect(() => {
    const sync = () => setView(storedEmailView())
    window.addEventListener(CHANGED, sync)
    // A change made in another tab.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const choose = useCallback((next: EmailView) => {
    setView(next)
    try { localStorage.setItem(KEY, next) } catch { /* nothing to remember it with. */ }
    window.dispatchEvent(new Event(CHANGED))
  }, [])

  return [view, choose]
}
