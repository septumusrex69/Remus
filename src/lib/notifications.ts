import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

/**
 * THE BELL (Remus · Handoff 1). Raptor's notifications, which Remus had none of until change requests
 * needed somebody to be told: "it would flag on my side". The database writes them (triggers on the
 * change-request tables); this reads the signed-in person's own, which is all RLS lets it see.
 *
 * One copy for the whole app, shared through a window event like unreadMail. Re-read when the bell
 * opens, when the window comes back into focus and once a minute -- a person waiting on "is my
 * request done" is told the next time they look, without a realtime socket held open on every phone.
 */
export interface AppNotification {
  id: string
  type: string
  message: string
  link: string | null
  read: boolean
  created_at: string
}

let items: AppNotification[] = []
const CHANGED = 'remus:notifications'
const emit = () => window.dispatchEvent(new Event(CHANGED))

export async function refreshNotifications(): Promise<void> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, message, link, read, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  // A bell that could not be read is not worth an error on the frame of every page.
  if (error) return
  items = (data ?? []) as AppNotification[]
  emit()
}

export async function markNotificationRead(id: string): Promise<void> {
  items = items.map((n) => (n.id === id ? { ...n, read: true } : n))
  emit()
  await supabase.from('notifications').update({ read: true }).eq('id', id)
}

export async function markAllNotificationsRead(): Promise<void> {
  const ids = items.filter((n) => !n.read).map((n) => n.id)
  if (!ids.length) return
  items = items.map((n) => ({ ...n, read: true }))
  emit()
  await supabase.from('notifications').update({ read: true }).in('id', ids)
}

/** "5m ago", "3h ago", "2d ago": a bell is read for what is new, not for the exact time. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function useNotifications() {
  const [list, setList] = useState(items)
  useEffect(() => {
    const on = () => setList(items)
    window.addEventListener(CHANGED, on)
    const onFocus = () => void refreshNotifications()
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void refreshNotifications(), 60_000)
    void refreshNotifications()
    return () => {
      window.removeEventListener(CHANGED, on)
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [])
  const refresh = useCallback(() => refreshNotifications(), [])
  return { notifications: list, unread: list.filter((n) => !n.read).length, refresh }
}
