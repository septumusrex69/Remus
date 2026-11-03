/**
 * THE PORTAL PAGE'S CALLS (Remus · Handoff 5, Raptor H13's portalApi) -- a client's browser, never staff.
 * Imports no Supabase: the client has no Supabase session.
 *
 * The session token lives in localStorage, read defensively: a private window or an iPad with site data
 * blocked throws on access, and the answer then is "sign in", not a blank page.
 */
const KEY = 'remus.portal.token'
/** api/_lib/portalRules.ts's PORTAL_TOKEN_HEADER (src cannot import api). */
const TOKEN_HEADER = 'x-portal-token'

export function portalToken(): string | null {
  try { return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY) } catch { return null }
}
/** Kept in this browser (Keep me signed in), or for this tab only -- closing it signs out (Raptor S16). */
export function savePortalToken(token: string | null, remember = true): void {
  try {
    localStorage.removeItem(KEY); sessionStorage.removeItem(KEY)
    if (token) (remember ? localStorage : sessionStorage).setItem(KEY, token)
  } catch { /* signed in for this tab only */ }
}

export class PortalSignedOut extends Error {}

async function call<T>(action: string, body: Record<string, unknown> = {}, token: string | null = null): Promise<T> {
  const res = await fetch(`/api/portal/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { [TOKEN_HEADER]: token } : {}) },
    body: JSON.stringify(body),
  })
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (res.status === 401) throw new PortalSignedOut(out.error ?? 'Please sign in again.')
  if (!res.ok) throw new Error(out.error ?? 'The portal could not be reached just now.')
  return out
}

export const requestPortalCode = (email: string) => call<{ message: string }>('request-code', { email })
export const verifyPortalCode = (email: string, code: string, reset = false, remember = true) =>
  call<{ token: string; expiresAt: string; needsPassword: boolean }>('verify', { email, code, reset, remember })
/* Remus · Handover 8 (Raptor S16): the everyday sign-in, and the password set after a code. */
export const portalSignInWithPassword = (email: string, password: string, remember = true) =>
  call<{ token: string; expiresAt: string }>('sign-in', { email, password, remember })
export const setPortalPassword = (token: string, password: string) => call<{ ok: boolean }>('set-password', { password }, token)

/** Who the sign-in page belongs to, before anybody signs in (the company's name, logo and how to reach it). */
export interface PortalBrand { name: string; phone: string | null; email: string | null; logoUrl: string | null }
export const fetchPortalBrand = () => call<PortalBrand>('brand')

export interface PortalMe {
  name: string
  email: string
  client: string
  company: { name: string; phone: string | null; email: string | null; logoUrl: string | null }
}
export const fetchPortalMe = (token: string) => call<PortalMe>('me', {}, token)

export type PortalStageState = 'done' | 'on' | 'next' | 'unplanned'
export interface PortalProject {
  id: string
  name: string
  code: string | null
  siteAddress: string | null
  status: string
  start: string | null
  finish: string | null
  /** 0-100 by the plan, or null when no stage is dated yet. */
  progress: number | null
  stages: { name: string; start: string | null; end: string | null; state: PortalStageState; stateLabel: string }[]
  /** Part 2: the diary days the office ticked for the client, newest first -- the day's "Work done" only. */
  notes: { date: string; text: string }[]
  /** Part 2: site photos ticked "Client sees", newest first; each link lasts an hour. */
  photos: { id: string; url: string; caption: string | null; date: string }[]
}
export interface PortalQuote {
  id: string; number: string | null; title: string; siteAddress: string | null; issued: string; validUntil: string | null; total: number | null; status: string
  /** Sent and still valid: the client may accept it here. */
  canAccept: boolean
  acceptedOnPortal: { by: string; at: string } | null
}
export interface PortalInvoice {
  number: string; issued: string; due: string | null; description: string; total: number; paid: number; owing: number
  state: 'paid' | 'overdue' | 'open'; project: string | null
}
export interface PortalOverview { today: string; projects: PortalProject[]; quotes: PortalQuote[]; invoices: PortalInvoice[] }
export const fetchPortalOverview = (token: string) => call<PortalOverview>('overview', {}, token)

/** The quote's PDF, as the office sends it: a Blob the page opens or saves. */
export async function fetchPortalQuotePdf(token: string, id: string): Promise<Blob> {
  const res = await fetch('/api/portal/quote-pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json', [TOKEN_HEADER]: token }, body: JSON.stringify({ id }),
  })
  if (res.status === 401) throw new PortalSignedOut('Please sign in again.')
  if (!res.ok) {
    const out = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(out.error ?? 'The PDF could not be opened just now.')
  }
  return res.blob()
}
export const acceptPortalQuote = (token: string, id: string, name: string, agreed: boolean) =>
  call<{ ok: boolean; acceptedAt: string }>('accept-quote', { id, name, agreed }, token)

export const portalSignOut = (token: string) => call<{ ok: boolean }>('sign-out', {}, token)
