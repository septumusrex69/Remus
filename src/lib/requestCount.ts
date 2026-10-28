import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * THE SIDEBAR'S COUNT ON REQUESTS, like Mail's (Raptor · Handoff 14's nav_request_count, copied in
 * Remus · Handoff 2). For an Administrator, requests still waiting for a decision; for anybody, their
 * own released requests waiting for their test. The database counts (nav_request_count, 0024).
 *
 * One copy for the whole app, shared through a window event like unreadMail. Re-read on focus, once a
 * minute, and the moment the request panel decides or tests one (refreshRequestCount).
 */
let count = 0
const CHANGED = 'remus:request-count'

export async function refreshRequestCount(): Promise<void> {
  const { data, error } = await supabase.rpc('nav_request_count')
  // A count that could not be read keeps its last value rather than flashing to zero.
  if (error) return
  count = Number(data ?? 0)
  window.dispatchEvent(new Event(CHANGED))
}

export function useRequestCount(): number {
  const [n, setN] = useState(count)
  useEffect(() => {
    const on = () => setN(count)
    const onFocus = () => void refreshRequestCount()
    window.addEventListener(CHANGED, on)
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void refreshRequestCount(), 60_000)
    void refreshRequestCount()
    return () => {
      window.removeEventListener(CHANGED, on)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [])
  return n
}
