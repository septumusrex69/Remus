/**
 * TELL US WHEN REMUS BREAKS, instead of waiting for someone to mention it (Remus · Handover 8, 7 Nov 2026). Copied from
 * Raptor 55a7520's src/lib/errorReporter.ts. Stephan, 7 Nov, on what Raptor has that Remus does not: "We can like
 * start with pretty much all of that."
 *
 * Three ways an error reaches here:
 *   - a page crashes while drawing          -> ErrorBoundary calls reportError()
 *   - a button or a timer throws            -> window 'error'
 *   - a promise rejects and nobody catches  -> window 'unhandledrejection'
 *
 * Each goes to /api/portal/report-error (an action on the portal's endpoint, so Remus needs no new server function:
 * api/_lib/errorAlert.ts), which stores it and, the first time, emails the active Administrators and rings their bell.
 *
 * Quiet on localhost: a developer mid-edit makes a dozen errors a minute and already has the console open. And on a
 * preview the server has no service key, so the report is simply refused there -- it is the live site that reports.
 * Set VITE_REPORT_ERRORS_LOCALLY=1 to test the pipe end to end.
 */
import { supabase } from './supabase'

const ENDPOINT = '/api/portal/report-error'
/** One bad loop must not become a thousand requests from one tab. */
const MAX_PER_SESSION = 15
const sent = new Set<string>()
let count = 0

export type ErrorSource = 'render' | 'window' | 'promise' | 'manual'

function enabled(): boolean {
  if (typeof window === 'undefined') return false
  const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  return !local || import.meta.env.VITE_REPORT_ERRORS_LOCALLY === '1'
}

/*
 * Noise that is not ours to fix: a browser extension throwing inside our page, a ResizeObserver that took two frames,
 * a tab that lost the network for a second, a new version deployed while the page was open (ErrorBoundary reloads for
 * that). Alerts that are always noise teach people to ignore alerts -- so these never become one.
 */
export const IGNORED: RegExp[] = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /chrome-extension:|moz-extension:|safari-extension:/i,
  /AbortError/i,
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i,
]

export function normalise(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack }
  if (typeof err === 'string') return { message: err }
  try { return { message: JSON.stringify(err) } } catch { return { message: String(err) } }
}

export function isNoise(message: string, stack?: string): boolean {
  return IGNORED.some((re) => re.test(message) || (!!stack && re.test(stack)))
}

export async function reportError(err: unknown, source: ErrorSource, extra?: { componentStack?: string }) {
  const { message, stack } = normalise(err)
  if (!enabled() || isNoise(message, stack)) return

  const key = `${message}|${stack?.split('\n')[1] ?? ''}`
  if (sent.has(key) || count >= MAX_PER_SESSION) return
  sent.add(key)
  count++

  // Who saw it is what makes a report useful ("ask Thabo what he pressed"). Optional: the sign-in page can crash too.
  let token: string | undefined
  try { token = (await supabase.auth.getSession()).data.session?.access_token } catch { /* fine */ }

  const body = JSON.stringify({
    message: message.slice(0, 1000),
    stack: stack?.slice(0, 6000),
    componentStack: extra?.componentStack?.slice(0, 4000),
    source,
    url: window.location.href,
    userAgent: navigator.userAgent,
    // The build that broke: Vite stamps a new name on every deploy, and the entry script carries it.
    build: document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src.split('/').pop(),
  })
  try {
    // keepalive lets the report finish even if the error is followed by a reload.
    await fetch(ENDPOINT, {
      method: 'POST',
      keepalive: body.length < 60_000,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
    })
  } catch {
    // A reporter that throws would report itself. Losing one report is the lesser harm.
  }
}

let installed = false
/** Call once, before the app draws. */
export function installGlobalErrorHandlers() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => { void reportError(e.error ?? e.message, 'window') })
  window.addEventListener('unhandledrejection', (e) => { void reportError(e.reason, 'promise') })
}
