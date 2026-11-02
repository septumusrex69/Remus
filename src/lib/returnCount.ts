import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * The sidebar's count on Returns (Remus · Handover 8): goods still waiting to go back to a store -- something one
 * person can clear today, the sidebar's rule. Same pattern as lib/requestCount.ts: one copy for the app, re-read on
 * focus, once a minute, and the moment a return is logged or closed (refreshReturnCount).
 */
let count = 0
const CHANGED = 'remus:return-count'

export async function refreshReturnCount(): Promise<void> {
  const { count: n, error } = await supabase.from('slip_returns').select('id', { count: 'exact', head: true }).eq('status', 'to_return')
  // A count that could not be read (the table not there yet) keeps its last value rather than flashing.
  if (error) return
  count = n ?? 0
  window.dispatchEvent(new Event(CHANGED))
}

export function useReturnCount(enabled = true): number {
  const [n, setN] = useState(count)
  useEffect(() => {
    if (!enabled) return
    const on = () => setN(count)
    const onFocus = () => void refreshReturnCount()
    window.addEventListener(CHANGED, on)
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void refreshReturnCount(), 60_000)
    void refreshReturnCount()
    return () => {
      window.removeEventListener(CHANGED, on)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [enabled])
  return enabled ? n : 0
}
