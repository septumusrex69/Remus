/**
 * The person's own mailbox (the Mail page), ported from Raptor's lib/userMail.ts.
 *
 * Every message the sync reads lives in `user_emails`, visible only to its owner. Filing a message
 * on a client also writes the client's Emails card (`activities`), which the whole team sees.
 * Debt-collection parts of Raptor's version (debtor files, account charges, tickets, leads) are
 * left out.
 */
import { supabase } from './supabase'
import { MAIL_CHANGED } from './api'
import type { ID } from '../types'

export type MailFilter = 'all' | 'junk' | 'sent'
export type Recipient = { name: string | null; address: string }

export interface LinkedClient {
  kind: 'company' | 'contact'
  id: ID
}

export interface MailItem {
  id: ID
  folder: string
  uid: number
  messageId: string | null
  fromAddress: string
  fromName: string | null
  subject: string | null
  snippet: string | null
  attachmentNames: string[]
  isJunk: boolean
  isSent: boolean
  toAddress: string | null
  toName: string | null
  toRecipients: Recipient[]
  ccRecipients: Recipient[]
  occurredAt: string
  readAt: string | null
  linkedCompanyId: ID | null
  linkedContactId: ID | null
}

interface Row {
  id: string
  folder: string
  uid: number
  message_id: string | null
  from_address: string
  from_name: string | null
  subject: string | null
  snippet: string | null
  attachment_names: string[] | null
  is_junk: boolean
  is_sent: boolean
  to_address: string | null
  to_name: string | null
  to_recipients: Recipient[] | null
  cc_recipients: Recipient[] | null
  occurred_at: string
  read_at: string | null
  linked_company_id: string | null
  linked_contact_id: string | null
}

const COLUMNS =
  'id, folder, uid, message_id, from_address, from_name, subject, snippet, attachment_names, is_junk, is_sent, to_address, to_name, to_recipients, cc_recipients, occurred_at, read_at, linked_company_id, linked_contact_id'

function toItem(r: Row): MailItem {
  return {
    id: r.id,
    folder: r.folder,
    uid: r.uid,
    messageId: r.message_id,
    fromAddress: r.from_address,
    fromName: r.from_name,
    subject: r.subject,
    snippet: r.snippet,
    attachmentNames: r.attachment_names ?? [],
    isJunk: r.is_junk,
    isSent: r.is_sent,
    toAddress: r.to_address,
    toName: r.to_name,
    toRecipients: r.to_recipients ?? [],
    ccRecipients: r.cc_recipients ?? [],
    occurredAt: r.occurred_at,
    readAt: r.read_at,
    linkedCompanyId: r.linked_company_id,
    linkedContactId: r.linked_contact_id,
  }
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

const changed = () => window.dispatchEvent(new Event(MAIL_CHANGED))

/** Narrows a query to a tab: All is the mailbox without junk or sent, as in Raptor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scope(q: any, filter: MailFilter) {
  if (filter === 'junk') return q.eq('is_junk', true)
  if (filter === 'sent') return q.eq('is_sent', true)
  return q.eq('is_junk', false).eq('is_sent', false)
}

/** Postgres ilike pattern for a search term, with its own % and _ taken literally. */
function likeTerm(term: string): string {
  return `%${term.replace(/[\\%_,()]/g, (c) => (c === ',' || c === '(' || c === ')' ? ' ' : `\\${c}`))}%`
}

/**
 * One page of the mailbox. `everywhere` searches the whole mailbox rather than the tab (Raptor's
 * default: somebody looking for a message doesn't know which tab it settled in).
 */
export async function fetchMail(input: {
  userId: ID
  filter: MailFilter
  search?: string
  everywhere?: boolean
  unreadOnly?: boolean
  page: number
  pageSize: number
}): Promise<{ items: MailItem[]; more: boolean }> {
  let q = supabase.from('user_emails').select(COLUMNS).eq('user_id', input.userId)
  const term = input.search?.trim()
  if (!term || !input.everywhere) q = scope(q, input.filter)
  if (term) {
    const t = likeTerm(term)
    q = q.or(`subject.ilike.${t},from_address.ilike.${t},from_name.ilike.${t},snippet.ilike.${t},to_address.ilike.${t}`)
  }
  if (input.unreadOnly) q = q.is('read_at', null)
  const from = input.page * input.pageSize
  const { data, error } = await q.order('occurred_at', { ascending: false }).range(from, from + input.pageSize)
  fail(error)
  const rows = (data ?? []) as unknown as Row[]
  return { items: rows.slice(0, input.pageSize).map(toItem), more: rows.length > input.pageSize }
}

export async function fetchMailItem(userId: ID, id: ID): Promise<MailItem | null> {
  const { data, error } = await supabase.from('user_emails').select(COLUMNS).eq('user_id', userId).eq('id', id).maybeSingle()
  fail(error)
  return data ? toItem(data as unknown as Row) : null
}

/** Unread per tab, so Junk says when something a spam filter misfiled is waiting (Raptor). */
export async function countUnreadByTab(userId: ID): Promise<Record<MailFilter, number>> {
  const count = async (filter: MailFilter) => {
    const { count: n } = await scope(
      supabase.from('user_emails').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null),
      filter,
    )
    return n ?? 0
  }
  const [all, junk] = await Promise.all([count('all'), count('junk')])
  return { all, junk, sent: 0 }
}

/** The kept body of a message. Null when it was too large to keep: open it in your mail app. */
export async function fetchBody(id: ID): Promise<{ text: string; html: string } | null> {
  const { data, error } = await supabase.from('user_emails').select('body_text, body_html, body_cached_at').eq('id', id).maybeSingle()
  fail(error)
  const row = data as { body_text: string | null; body_html: string | null; body_cached_at: string | null } | null
  if (!row?.body_cached_at || (!row.body_text && !row.body_html)) return null
  return { text: row.body_text ?? '', html: row.body_html ?? '' }
}

/**
 * Read state, mirrored to the client's Emails card: the same message read in the mailbox is read
 * on the client too, and the counts everywhere agree.
 */
async function setRead(userId: ID, items: MailItem[], read: boolean): Promise<void> {
  const ids = items.map((m) => m.id)
  if (ids.length === 0) return
  const { error } = await supabase.from('user_emails').update({ read_at: read ? new Date().toISOString() : null }).in('id', ids)
  fail(error)
  const messageIds = items.map((m) => m.messageId).filter((x): x is string => !!x)
  // Only this person's copy: a colleague copied on the same email keeps their own read state.
  if (messageIds.length) await supabase.from('activities').update({ is_read: read }).eq('user_id', userId).in('email_message_id', messageIds)
  changed()
}
export const markMailRead = (userId: ID, items: MailItem[]) => setRead(userId, items, true)
export const markMailUnread = (userId: ID, items: MailItem[]) => setRead(userId, items, false)

/** Moves to or out of Junk in Remus (the message stays where it is in the mailbox itself). */
export async function setJunk(ids: ID[], junk: boolean): Promise<void> {
  const { error } = await supabase.from('user_emails').update({ is_junk: junk }).in('id', ids)
  fail(error)
  changed()
}

/**
 * Takes messages out of Remus. The mailbox itself keeps them, and anything already filed on a
 * client stays on the client's Emails card.
 */
export async function deleteMail(ids: ID[]): Promise<void> {
  const { error } = await supabase.from('user_emails').delete().in('id', ids)
  fail(error)
  changed()
}

// ---------- Blocking (Raptor's mail_blocks) ----------

export interface BlockedSender {
  id: ID
  pattern: string
  kind: 'address' | 'domain'
  label: string | null
  createdAt: string
}

/** Domains shared by millions of people: blocking one would block everybody on Gmail. */
const SHARED_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com',
  'mweb.co.za', 'telkomsa.net', 'vodamail.co.za', 'webmail.co.za', 'iafrica.com', 'absamail.co.za', 'lantic.net',
])

export function domainOf(address: string): string | null {
  const at = address.lastIndexOf('@')
  return at > -1 ? address.slice(at + 1).toLowerCase() : null
}

export function isSharedDomain(address: string): boolean {
  const d = domainOf(address)
  return !!d && SHARED_DOMAINS.has(d)
}

export async function fetchBlockedSenders(userId: ID): Promise<BlockedSender[]> {
  const { data, error } = await supabase.from('mail_blocks').select('id, pattern, kind, label, created_at').eq('user_id', userId).order('created_at', { ascending: false })
  fail(error)
  return (data ?? []).map((r) => ({ id: r.id, pattern: r.pattern, kind: r.kind, label: r.label, createdAt: r.created_at }))
}

/** Blocks a sender (or their whole domain) and clears what they have already sent from Remus. */
export async function blockSender(input: { userId: ID; address: string; kind: 'address' | 'domain'; label?: string | null }): Promise<number> {
  const pattern = input.kind === 'domain' ? domainOf(input.address) : input.address.toLowerCase()
  if (!pattern) throw new Error('That address has no domain.')
  const { error } = await supabase.from('mail_blocks').upsert(
    { user_id: input.userId, pattern, kind: input.kind, label: input.label ?? null },
    { onConflict: 'user_id,pattern', ignoreDuplicates: true },
  )
  fail(error)
  let q = supabase.from('user_emails').delete({ count: 'exact' }).eq('user_id', input.userId).eq('is_sent', false)
  q = input.kind === 'domain' ? q.ilike('from_address', `%@${pattern}`) : q.eq('from_address', pattern)
  const { count, error: delError } = await q
  fail(delError)
  changed()
  return count ?? 0
}

export async function unblockSender(id: ID): Promise<void> {
  const { error } = await supabase.from('mail_blocks').delete().eq('id', id)
  fail(error)
}

// ---------- Filing on a client ----------

/**
 * Files a message on a client: the mailbox row says so, and it joins the client's Emails card
 * (where the whole team sees it). The card is keyed on the Message-ID, so filing twice doesn't
 * add it twice.
 */
export async function fileOnClient(input: {
  userId: ID
  mail: MailItem
  body: string
  client: LinkedClient
  companyIdOfContact?: ID | null
}): Promise<void> {
  const companyId = input.client.kind === 'company' ? input.client.id : input.companyIdOfContact ?? null
  const contactId = input.client.kind === 'contact' ? input.client.id : null
  const { error } = await supabase
    .from('user_emails')
    .update({ linked_company_id: companyId, linked_contact_id: contactId, linked_at: new Date().toISOString(), linked_by: input.userId })
    .eq('id', input.mail.id)
  fail(error)
  const direction = input.mail.isSent ? 'Email sent' : input.mail.isJunk ? 'Email received (was in Spam/Junk)' : 'Email received'
  const row = {
    type: 'Email',
    user_id: input.userId,
    company_id: companyId,
    contact_id: contactId,
    subject: `${direction}: ${input.mail.subject || '(no subject)'}`,
    notes: input.body.slice(0, 20000),
    activity_date: input.mail.occurredAt,
    email_message_id: input.mail.messageId,
    is_read: true,
    attachment_names: input.mail.attachmentNames,
    email_folder: input.mail.folder,
    email_uid: input.mail.uid,
  }
  const res = input.mail.messageId
    ? await supabase.from('activities').upsert(row, { onConflict: 'user_id,email_message_id' })
    : await supabase.from('activities').insert(row)
  fail(res.error)
  changed()
}

/** Takes a message off the client it was filed on, in the mailbox and on the client's card. */
export async function unfileFromClient(userId: ID, mail: MailItem): Promise<void> {
  const { error } = await supabase
    .from('user_emails')
    .update({ linked_company_id: null, linked_contact_id: null, linked_at: null, linked_by: null })
    .eq('id', mail.id)
  fail(error)
  if (mail.messageId) await supabase.from('activities').delete().eq('user_id', userId).eq('email_message_id', mail.messageId)
  changed()
}

/** Downloads one attachment straight from the mailbox, through the server. */
export async function downloadMailAttachment(mailId: ID, filename: string): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const res = await fetch('/api/email/attachment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ mailId, filename }),
  })
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(b?.error ?? 'Could not download that attachment.')
  }
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ---------- Replying and forwarding (Raptor's emailRules) ----------

/** "Re: " once, never "Re: Re: ". */
export function replySubject(subject: string | null): string {
  const s = (subject ?? '').trim()
  return /^re:/i.test(s) ? s : `Re: ${s || '(no subject)'}`
}

export function forwardSubject(subject: string | null): string {
  const s = (subject ?? '').trim()
  return /^(fw|fwd):/i.test(s) ? s : `Fwd: ${s || '(no subject)'}`
}

/**
 * Reply all: the sender plus everyone else who was on it, without me. Being copied on your own
 * reply-all doubles the thread every round (Raptor's replyAllTo).
 */
export function replyAllTo(mail: MailItem, mine: (string | null | undefined)[]): { to: string; cc: string[] } {
  const me = new Set(mine.filter((x): x is string => !!x).map((x) => x.toLowerCase()))
  const seen = new Set<string>()
  const keep = (a: string) => {
    const k = a.toLowerCase()
    if (me.has(k) || seen.has(k)) return false
    seen.add(k)
    return true
  }
  const to = keep(mail.fromAddress) ? mail.fromAddress : ''
  const cc = [...mail.toRecipients, ...mail.ccRecipients].map((r) => r.address).filter(keep)
  return { to, cc }
}

/** The quoted original under a reply or a forward. */
export function quoteBlock(mail: MailItem, body: string, kind: 'reply' | 'forward'): string {
  const when = new Date(mail.occurredAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
  const who = mail.fromName ? `${mail.fromName} <${mail.fromAddress}>` : mail.fromAddress
  if (kind === 'forward') {
    const to = mail.toRecipients.map((r) => r.address).join(', ')
    return `\n\n---------- Forwarded message ----------\nFrom: ${who}\nDate: ${when}\nSubject: ${mail.subject ?? ''}\n${to ? `To: ${to}\n` : ''}\n${body}`
  }
  return `\n\nOn ${when}, ${who} wrote:\n${body.split('\n').map((l) => `> ${l}`).join('\n')}`
}
