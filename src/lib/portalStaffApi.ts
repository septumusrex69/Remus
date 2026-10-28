/**
 * WHO AT A CLIENT MAY SIGN IN TO THE PORTAL -- the staff half (Remus · Handoff 5, Raptor H13). The
 * tables have no policies (0026), so even this goes through api/portal with the caller's session.
 */
import { supabase } from './supabase'

async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('You are signed out. Sign in again and retry.')
  const res = await fetch(`/api/portal/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(out.error ?? 'The portal could not be reached just now.')
  return out
}

export interface PortalContact {
  id: string
  email: string
  name: string
  active: boolean
  invited_at: string
  last_login_at: string | null
}

/** A company client or a private one: exactly one of the two. */
export type PortalClient = { companyId: string } | { contactId: string }

export const fetchPortalContacts = (client: PortalClient) =>
  call<{ users: PortalContact[] }>('staff-list', client).then((r) => r.users)
export const invitePortalContact = (client: PortalClient, email: string, name: string) =>
  call<{ id: string; emailed: boolean; emailError: string | null; url: string }>('staff-invite', { ...client, email, name })
export const setPortalContactActive = (id: string, active: boolean) =>
  call<{ ok: boolean }>('staff-set-active', { id, active })
