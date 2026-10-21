import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { inviteUser, listProfiles, updateProfileAccess } from '../../../lib/api'
import { useLoad } from '../../../hooks/useLoad'
import { useAuth } from '../../../store/AuthContext'
import { Badge, Button, Card, ErrorBanner, Field, Modal } from '../../../components/ui'
import type { Profile } from '../../../types'

/** The roles Remus distinguishes. Raptor's other roles (Sales Manager, …) behave like a team member. */
const ROLE_OPTIONS: { value: Profile['role']; label: string }[] = [
  { value: 'Administrator', label: 'Administrator' },
  { value: 'Sales Representative', label: 'Team member' },
  { value: 'Read Only', label: 'Read only' },
]

function roleLabel(role: Profile['role']): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? 'Team member'
}

export function TeamCard() {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'Administrator'
  const team = useLoad(() => listProfiles())
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invite, setInvite] = useState({ email: '', name: '', role: 'Sales Representative' as Profile['role'] })
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function change(p: Profile, values: Pick<Partial<Profile>, 'role' | 'status'>) {
    setError(null)
    try {
      await updateProfileAccess(p.id, values)
      team.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function sendInvite() {
    setSending(true)
    setError(null)
    try {
      await inviteUser({ email: invite.email.trim(), name: invite.name.trim() || undefined, role: invite.role })
      setNotice(`Invite sent to ${invite.email.trim()}.`)
      setInvite({ email: '', name: '', role: 'Sales Representative' })
      setInviteOpen(false)
      team.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Card
      title="Team"
      padded={false}
      actions={isAdmin ? <Button size="sm" onClick={() => setInviteOpen(true)}><UserPlus size={14} /> Invite</Button> : undefined}
    >
      {(error || notice) && (
        <div className="px-4 pt-3">
          <ErrorBanner error={error} />
          {notice && <p className="text-sm text-emerald-700">{notice}</p>}
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {(team.data ?? []).map((p) => {
          const self = p.id === currentUser?.id
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: p.avatar_color }}>
                {(p.name || p.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name || '—'}{self && <span className="text-slate-400"> (you)</span>}</span>
                <span className="block truncate text-xs text-slate-500">{p.email}</span>
              </span>
              {isAdmin && !self ? (
                <>
                  <select className="input w-auto py-1 text-xs" value={ROLE_OPTIONS.some((r) => r.value === p.role) ? p.role : 'Sales Representative'} onChange={(e) => change(p, { role: e.target.value as Profile['role'] })} aria-label={`Role for ${p.name || p.email}`}>
                    {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => change(p, { status: p.status === 'Active' ? 'Inactive' : 'Active' })}>
                    {p.status === 'Active' ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </>
              ) : (
                <Badge>{roleLabel(p.role)}</Badge>
              )}
              {p.status === 'Inactive' && <Badge tone="bg-red-50 text-red-700">Inactive</Badge>}
            </li>
          )
        })}
      </ul>
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        Team members can see and edit all company data; read-only people can only look. Deactivating someone removes their access straight away.
      </p>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite someone"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={sendInvite} loading={sending} disabled={!invite.email.trim()}>Send invite</Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Email"><input className="input" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} autoFocus /></Field>
          <Field label="Name"><input className="input" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} /></Field>
          <Field label="Access">
            <select className="input" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Profile['role'] })}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <p className="text-xs text-slate-500">They'll get an email with a link to choose a password.</p>
        </div>
      </Modal>
    </Card>
  )
}
