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
  try { return localStorage.getItem(KEY) } catch { return null }
}
export function savePortalToken(token: string | null): void {
  try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY) } catch { /* signed in for this tab only */ }
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
export const verifyPortalCode = (email: string, code: string) => call<{ token: string; expiresAt: string }>('verify', { email, code })

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
}
export interface PortalQuote {
  number: string | null; title: string; siteAddress: string | null; issued: string; validUntil: string | null; total: number | null; status: string
}
export interface PortalInvoice {
  number: string; issued: string; due: string | null; description: string; total: number; paid: number; owing: number
  state: 'paid' | 'overdue' | 'open'; project: string | null
}
export interface PortalOverview { today: string; projects: PortalProject[]; quotes: PortalQuote[]; invoices: PortalInvoice[] }
export const fetchPortalOverview = (token: string) => call<PortalOverview>('overview', {}, token)

export const portalSignOut = (token: string) => call<{ ok: boolean }>('sign-out', {}, token)
