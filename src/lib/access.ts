/**
 * WHO SEES WHAT (Remus · Handoff 5, 28 Oct 2026). Stephan: "administrators can see it. Contractors can't
 * see the finances, but everything else they should know more or less ... if we're working in budget
 * ... And then you get site managers." General workers do not sign in: the contractor or a site manager
 * fills in the crew register for them.
 *
 *   admin         everything.
 *   read_only     everything, changes nothing (unchanged).
 *   contractor    the jobs, plans, crew, clients, and quotes as the client sees them (the print view);
 *                 each job's budget in words and percentages -- never rand, cost, markup or profit.
 *   site_manager  the jobs, plan, schedule, crew register and diary; no money at all, no quotes. Snap slip
 *                 only when an Administrator ticks it for that person (Stephan, 29 Oct: "It's not a site
 *                 manager who does purchases, it's a contractor ... possible to give him the authority to
 *                 snap a slip as well"). The database holds the same rule (0028, may_snap_slips).
 *                 The database refuses them the money records too (0027, sees_money_records).
 *
 * A contractor and a site manager are both role 'Sales Representative' (Raptor's role list, kept), told
 * apart by profiles.job (0027).
 */
import type { Profile } from '../types'
import { useAuth } from '../store/AuthContext'

export type Access = 'admin' | 'read_only' | 'contractor' | 'site_manager'

export const ACCESS_LABEL: Record<Access, string> = {
  admin: 'Administrator', contractor: 'Contractor', site_manager: 'Site manager', read_only: 'Read only',
}
export const ACCESS_HINT: Record<Access, string> = {
  admin: 'Everything, including profit, costs, invoices and the bank.',
  contractor: 'The jobs, plans, crew and clients; quotes as the client sees them; each job’s budget in percentages, never rand.',
  site_manager: 'The jobs, plan, schedule, crew register and diary. No money and no quotes. Snap slip only if you tick it.',
  read_only: 'Sees everything, changes nothing.',
}

export function accessOf(p: Pick<Profile, 'role'> & { job?: string | null } | null | undefined): Access {
  if (!p) return 'site_manager'
  if (p.role === 'Administrator') return 'admin'
  if (p.role === 'Read Only') return 'read_only'
  return p.job === 'contractor' ? 'contractor' : 'site_manager'
}

/** What a choice in Settings -> Users writes: the role, and the job for the two team kinds. */
export function profileFor(a: Access): { role: Profile['role']; job: 'contractor' | 'site_manager' } {
  if (a === 'admin') return { role: 'Administrator', job: 'site_manager' }
  if (a === 'read_only') return { role: 'Read Only', job: 'site_manager' }
  return { role: 'Sales Representative', job: a }
}

/** Rand amounts, costs, profit, invoices, the bank, wages and rates. */
export const seesMoney = (a: Access) => a === 'admin' || a === 'read_only'
/** Whether each job is on budget, in words and percentages. */
export const seesBudget = (a: Access) => seesMoney(a) || a === 'contractor'
/** Quotes at all (a contractor sees them as the client does; a site manager not at all). */
export const seesQuotes = (a: Access) => a !== 'site_manager'
/** The quote editor, with its costs and markup. */
export const editsQuotes = (a: Access) => seesMoney(a)

/** May this person snap slips? Administrators and contractors; a site manager when ticked (0028). */
export function snapsSlips(p: (Pick<Profile, 'role'> & { job?: string | null; can_snap?: boolean | null }) | null | undefined): boolean {
  const a = accessOf(p)
  return a === 'admin' || a === 'contractor' || (a === 'site_manager' && !!p?.can_snap)
}

export function useSnapsSlips(): boolean {
  const { currentUser } = useAuth()
  return snapsSlips(currentUser)
}

export function useAccess(): Access {
  const { currentUser } = useAuth()
  return accessOf(currentUser)
}
