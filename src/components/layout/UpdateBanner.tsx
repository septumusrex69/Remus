import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * "Remus has been updated: Reload" (26 Oct 2026). An open tab, and above all Remus installed on a
 * home screen, keeps running the version it started with; Stephan kept seeing fixed problems
 * ("032") on a tab opened before the fix. So the app asks the server which version is current, when
 * it comes back into view and every few minutes, and offers a reload when it has moved on.
 *
 * The version is the name of the main script Vite puts in index.html (it changes on every build).
 * In development there is none, and nothing is shown.
 */
function scriptOf(html: string): string | null {
  return /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1] ?? null
}

export function UpdateBanner() {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    const mine = document.querySelector<HTMLScriptElement>('script[type="module"][src^="/assets/index-"]')?.getAttribute('src') ?? null
    if (!mine) return
    let stop = false
    async function check() {
      if (stop || document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/', { cache: 'no-store' })
        const latest = scriptOf(await res.text())
        if (latest && latest !== mine) setStale(true)
      } catch {
        // Offline or a blip: try again next time.
      }
    }
    const timer = window.setInterval(check, 5 * 60 * 1000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    void check()
    return () => {
      stop = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [])

  if (!stale) return null
  return (
    <div className="no-print flex items-center justify-center gap-3 bg-brand-600 px-4 py-2 text-sm text-white">
      <span>Remus has been updated.</span>
      <button className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 font-semibold hover:bg-white/25" onClick={() => window.location.reload()}>
        <RefreshCw size={14} /> Reload
      </button>
    </div>
  )
}

/** The service worker that makes Remus installable (public/sw.js). Production only. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not installable then, but Remus works exactly the same in the browser.
    })
  })
}
