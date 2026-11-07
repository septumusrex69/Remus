/**
 * A CLIENT'S STATEMENT OF ACCOUNT, FROM THE BROWSER (Remus · Handover 8). Stephan, 7 Nov: "Definitely a statement
 * of account."
 *
 * The statement is worked out and drawn on the server (api/_lib/statement.ts, statementPdf.ts), the way the quote
 * PDF is, so the file a client gets by email, by WhatsApp or from Downloads is one and the same. This file asks for
 * it: Preview (a new tab), Download, Share (the phone's share sheet, for WhatsApp), and Email (the same send path as
 * a quote: the person's own mailbox, else the company sender).
 */
import { supabase } from './supabase'
import { periodRange, type PeriodKey } from './period'
import type { Company, Contact } from '../types'

export type StatementKind = 'company' | 'contact'

export interface StatementAsk {
  kind: StatementKind
  id: string
  /** yyyy-mm-dd, or null for everything up to `to`. */
  from: string | null
  to: string
}

/** The statement periods: Finance's, plus "Everything" (a statement from the first invoice). */
export type StatementPeriod = Exclude<PeriodKey, 'custom'> | 'all'
export const STATEMENT_PERIODS: { id: StatementPeriod; label: string }[] = [
  { id: 'last_3', label: 'Last 3 months' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_fy', label: 'This tax year (Mar–Feb)' },
  { id: 'last_12', label: 'Last 12 months' },
  { id: 'all', label: 'Everything' },
]

export function statementRange(p: StatementPeriod, now = new Date()): { from: string | null; to: string } {
  if (p === 'all') return { from: null, to: periodRange('this_month', now).to }
  return periodRange(p, now)
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function statementUrl(a: StatementAsk): string {
  const q = new URLSearchParams({ statement: a.kind, client: a.id, to: a.to })
  if (a.from) q.set('from', a.from)
  return `/api/quotes/pdf?${q.toString()}`
}

async function fetchStatement(a: StatementAsk): Promise<File> {
  let res: Response
  try {
    res = await fetch(statementUrl(a), { headers: await authHeader() })
  } catch {
    throw new Error("Couldn't reach the server to build the statement. Check your connection and try again.")
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Could not build the statement (HTTP ${res.status}).`)
  }
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'Statement.pdf'
  return new File([await res.blob()], name, { type: 'application/pdf' })
}

function saveFile(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Opens the statement in a new tab (opened on the tap itself, so iPad Safari allows it). */
export async function previewStatement(a: StatementAsk): Promise<void> {
  const win = window.open('', '_blank')
  try {
    const file = await fetchStatement(a)
    const url = URL.createObjectURL(file)
    if (win) win.location.href = url
    else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    win?.close()
    throw e
  }
}

/** Saves it to Downloads (Stephan, 26 Oct, of the quote: he wants it "in my downloads"). */
export async function downloadStatement(a: StatementAsk): Promise<void> {
  saveFile(await fetchStatement(a))
}

/** The phone's share sheet with the PDF (pick WhatsApp there); a computer downloads it instead. */
export async function shareStatement(a: StatementAsk, text?: string): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const file = await fetchStatement(a)
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name.replace(/\.pdf$/i, ''), ...(text ? { text } : {}) })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
  }
  saveFile(file)
  return 'downloaded'
}

/** Emails it through api/quotes/send.ts (the quote's path). */
export async function sendStatement(a: StatementAsk, payload: { to: string[]; cc: string[]; subject: string; message: string }): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/quotes/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ statement: a, ...payload }),
    })
  } catch {
    throw new Error("Couldn't reach the server to send the statement. Check your connection and try again.")
  }
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (!res.ok || !body?.ok) throw new Error(body?.error ?? `Sending failed (HTTP ${res.status}). Try again, or download the statement and email it yourself.`)
}

/** The words that go with the statement on WhatsApp; edited there before sending (lib/whatsapp.ts's pattern). */
export function statementWhatsAppMessage(input: { firstName?: string | null; senderName?: string | null; companyName?: string | null; owing?: string | null }): string {
  const hello = input.firstName ? `Good day ${input.firstName}` : 'Good day'
  const company = input.companyName?.trim() || 'Urban Haus'
  const who = input.senderName ? `this is ${input.senderName} from ${company}` : `this is ${company}`
  const owing = input.owing ? ` The amount due is ${input.owing}.` : ''
  return `${hello}, ${who}. Please find your statement of account attached.${owing} Let me know if you have any questions.`
}

/** The email that goes with it, edited before sending. */
export function statementEmailMessage(input: { firstName?: string | null; companyName?: string | null; senderName?: string | null }): string {
  const hello = input.firstName ? `Good day ${input.firstName},` : 'Good day,'
  const sign = [input.senderName, input.companyName].filter(Boolean).join('\n')
  return `${hello}\n\nPlease find your statement of account attached. If anything on it does not agree with your own record, let us know and we will check it.\n\nKind regards,\n${sign}`
}

/**
 * Who a statement goes to, from the client's record: the company's email (else its first person's) and every
 * number that could reach them, the people's cellphones first; a private client's own.
 */
export function statementClientFor(
  kind: StatementKind,
  record: Pick<Company, 'id' | 'name' | 'email' | 'phone'> | Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'mobile' | 'phone'>,
  people: Pick<Contact, 'first_name' | 'last_name' | 'email' | 'mobile' | 'phone'>[] = [],
) {
  if (kind === 'company') {
    const c = record as Pick<Company, 'id' | 'name' | 'email' | 'phone'>
    const first = people.find((p) => p.email) ?? people[0]
    return {
      kind, id: c.id, name: c.name,
      email: c.email ?? first?.email ?? null,
      firstName: first?.first_name || null,
      numbers: [
        ...people.flatMap((p) => [p.mobile, p.phone].filter((n): n is string => !!n).map((value) => ({ label: `${p.first_name} ${p.last_name}`.trim(), value }))),
        ...(c.phone ? [{ label: c.name, value: c.phone }] : []),
      ],
    }
  }
  const p = record as Pick<Contact, 'id' | 'first_name' | 'last_name' | 'email' | 'mobile' | 'phone'>
  const name = `${p.first_name} ${p.last_name}`.trim()
  return {
    kind, id: p.id, name, email: p.email, firstName: p.first_name || null,
    numbers: [p.mobile, p.phone].filter((n): n is string => !!n).map((value) => ({ label: name, value })),
  }
}
