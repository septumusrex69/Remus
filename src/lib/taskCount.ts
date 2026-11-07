import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { endOfToday } from './tasks'

/**
 * The sidebar's count on Tasks (Remus · Handover 8), Raptor's rule from nav_counts: MY tasks, still open, due by
 * tonight (overdue included) -- "something one person can clear today", never all my tasks, "which would be a
 * permanent number nobody could ever clear". Same pattern as lib/returnCount.ts: one copy for the app, re-read on
 * focus, once a minute, and the moment a task is added, ticked or moved (refreshTaskCount).
 */
let count = 0
const CHANGED = 'remus:task-count'

export async function refreshTaskCount(): Promise<void> {
  const { data: who } = await supabase.auth.getSession()
  const me = who.session?.user.id
  if (!me) return
  const { count: n, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', me)
    .in('status', ['Not Started', 'In Progress'])
    .lt('due_date', endOfToday())
  // A count that could not be read (the table not there yet) keeps its last value rather than flashing.
  if (error) return
  count = n ?? 0
  window.dispatchEvent(new Event(CHANGED))
}

export function useTaskCount(): number {
  const [n, setN] = useState(count)
  useEffect(() => {
    const on = () => setN(count)
    const onFocus = () => void refreshTaskCount()
    window.addEventListener(CHANGED, on)
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void refreshTaskCount(), 60_000)
    void refreshTaskCount()
    return () => {
      window.removeEventListener(CHANGED, on)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [])
  return n
}
