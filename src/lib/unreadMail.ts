import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { MAIL_CHANGED, listUnreadEmails, setEmailRead, syncMailbox } from './api'
import type { Activity } from '../types'

/**
 * The signed-in person's unread client mail: the Mail badge in the sidebar and the envelope in the
 * top bar (Raptor's MessagesMenu and navCounts).
 *
 * YOUR unread mail, not the team's, as in Raptor: everyone sees every client's email, so counting
 * all of it would put a number on the badge no action of yours could clear. A synced email carries
 * the id of the mailbox it arrived in, which is the person actually being waited on.
 *
 * One copy for the whole app, shared through a window event like the sidebar fold, so the badge
 * and the envelope can never disagree.
 */
let items: Activity[] = []
let syncing = false
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
    items = await listUnreadEmails(id)
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
  } catch {
    // No mailbox connected, or offline: the list still shows whatever was already synced.
  } finally {
    syncing = false
    await refresh()
  }
}

async function markRead(ids: string[]): Promise<void> {
  items = items.filter((a) => !ids.includes(a.id))
  emit()
  await Promise.all(ids.map((id) => setEmailRead(id, true).catch(() => {})))
}

export function useUnreadMail() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick((t) => t + 1)
    const changed = () => void refresh()
    window.addEventListener(CHANGED, on)
    // A message opened or marked unread anywhere (a client page, the Mail page) recounts here.
    window.addEventListener(MAIL_CHANGED, changed)
    void myId().then((id) => {
      if (id && loadedFor !== id) void sync()
    })
    return () => {
      window.removeEventListener(CHANGED, on)
      window.removeEventListener(MAIL_CHANGED, changed)
    }
  }, [])
  const markAllRead = useCallback(() => markRead(items.map((a) => a.id)), [])
  return { count: items.length, items, syncing, sync, refresh, markRead, markAllRead }
}
