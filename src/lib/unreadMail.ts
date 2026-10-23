import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { MAIL_CHANGED, syncMailbox } from './api'
import { fetchMail, markMailRead, type MailItem } from './mailbox'

/**
 * The signed-in person's unread mail: the Mail badge in the sidebar and the envelope in the top bar
 * (Raptor's MessagesMenu and navCounts). Their own mailbox, Junk and Sent aside, which is the same
 * number the Mail page's All tab shows, so the two can never contradict each other on one screen.
 *
 * One copy for the whole app, shared through a window event like the sidebar fold.
 */
let items: MailItem[] = []
let count = 0
let syncing = false
/** Why the last sync failed, shown on the Mail page rather than swallowed. Null when it worked. */
let syncError: string | null = null
let loadedFor: string | null = null
const CHANGED = 'remus:unread-mail'
const emit = () => window.dispatchEvent(new Event(CHANGED))

async function myId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

async function refresh(): Promise<void> {
  const id = await myId()
  if (!id) return
  try {
    const [page, total] = await Promise.all([
      fetchMail({ userId: id, filter: 'all', unreadOnly: true, page: 0, pageSize: 30 }),
      supabase
        .from('user_emails')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', id)
        .is('read_at', null)
        .eq('is_junk', false)
        .eq('is_sent', false),
    ])
    items = page.items
    count = total.count ?? page.items.length
    loadedFor = id
    emit()
  } catch {
    // A count that could not be read is not worth an error on the frame of every page.
  }
}

/**
 * Reads the mailbox, then recounts. The cron only runs once a day, so the app pulls the person's
 * own mailbox when they arrive and when they open the envelope, which is exactly when they are
 * asking "has anyone written to me" (Raptor's MessagesMenu does the same).
 */
async function sync(): Promise<void> {
  if (syncing) return
  syncing = true
  emit()
  try {
    await syncMailbox()
    syncError = null
  } catch (e) {
    // The list still shows whatever was already synced; the Mail page says why nothing new came.
    syncError = e instanceof Error ? e.message : String(e)
  } finally {
    syncing = false
    await refresh()
  }
}

async function markRead(mails: MailItem[]): Promise<void> {
  const id = await myId()
  if (!id || mails.length === 0) return
  const ids = new Set(mails.map((m) => m.id))
  items = items.filter((m) => !ids.has(m.id))
  count = Math.max(0, count - ids.size)
  emit()
  await markMailRead(id, mails).catch(() => {})
}

export function useUnreadMail() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick((t) => t + 1)
    const changed = () => void refresh()
    window.addEventListener(CHANGED, on)
    // A message read or marked unread anywhere (the Mail page, a client page) recounts here.
    window.addEventListener(MAIL_CHANGED, changed)
    void myId().then((id) => {
      if (id && loadedFor !== id) void sync()
    })
    return () => {
      window.removeEventListener(CHANGED, on)
      window.removeEventListener(MAIL_CHANGED, changed)
    }
  }, [])
  const markAllRead = useCallback(() => markRead(items), [])
  return { count, items, syncing, syncError, sync, refresh, markRead, markAllRead }
}
