import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * The sidebar's count on Requests (Raptor H13's nav_request_count, Remus · Handoff 5): for an
 * Administrator the requests waiting for a decision, for anybody their own releases waiting for their
 * test -- something one person can clear today, the sidebar's rule. One copy for the app, re-read on
 * focus, once a minute, and the moment a request is decided or tested (refreshRequestCount).
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
