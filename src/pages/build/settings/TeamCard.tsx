import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { inviteUser, listProfiles, updateProfileAccess } from '../../../lib/api'
import { useLoad } from '../../../hooks/useLoad'
import { useAuth } from '../../../store/AuthContext'
import { Badge, Button, Card, ErrorBanner, Field, Modal } from '../../../components/ui'
import type { Profile } from '../../../types'
import { ACCESS_HINT, ACCESS_LABEL, accessOf, profileFor, type Access } from '../../../lib/access'

/** The kinds of login Remus distinguishes (lib/access.ts). General workers do not sign in. */
const ACCESS_OPTIONS: Access[] = ['admin', 'contractor', 'site_manager', 'read_only']

export function TeamCard() {
  const { currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'Administrator'
  const team = useLoad(() => listProfiles(), [], 'team')
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invite, setInvite] = useState({ email: '', name: '', access: 'site_manager' as Access })
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function change(p: Profile, values: Pick<Partial<Profile>, 'role' | 'status' | 'job' | 'can_snap'>) {
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
      await inviteUser({ email: invite.email.trim(), name: invite.name.trim() || undefined, ...profileFor(invite.access) })
      setNotice(`Invite sent to ${invite.email.trim()}.`)
      setInvite({ email: '', name: '', access: 'site_manager' })
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
                  <select className="input w-auto py-1 text-xs" value={accessOf(p)} onChange={(e) => change(p, profileFor(e.target.value as Access))} aria-label={`Access for ${p.name || p.email}`}>
                    {ACCESS_OPTIONS.map((a) => <option key={a} value={a}>{ACCESS_LABEL[a]}</option>)}
                  </select>
                  {/* A site manager does not buy; an Administrator may still let one snap slips (0028). */}
                  {accessOf(p) === 'site_manager' && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-600" title="Lets this site manager photograph till slips (Snap slip)">
                      <input type="checkbox" checked={!!p.can_snap} onChange={(e) => change(p, { can_snap: e.target.checked })} />
                      May snap slips
                    </label>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => change(p, { status: p.status === 'Active' ? 'Inactive' : 'Active' })}>
                    {p.status === 'Active' ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </>
              ) : (
                <Badge>{ACCESS_LABEL[accessOf(p)]}{accessOf(p) === 'site_manager' && p.can_snap ? ' · snaps slips' : ''}</Badge>
              )}
              {p.status === 'Inactive' && <Badge tone="bg-red-50 text-red-700">Inactive</Badge>}
            </li>
          )
        })}
      </ul>
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        {ACCESS_OPTIONS.map((a) => <span key={a} className="block"><strong className="font-medium text-slate-700">{ACCESS_LABEL[a]}:</strong> {ACCESS_HINT[a]}</span>)}
        <span className="mt-1 block">General workers do not need a login: the contractor or a site manager fills in the crew register for them. Deactivating someone removes their access straight away.</span>
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
            <select className="input" value={invite.access} onChange={(e) => setInvite({ ...invite, access: e.target.value as Access })}>
              {ACCESS_OPTIONS.map((a) => <option key={a} value={a}>{ACCESS_LABEL[a]}</option>)}
            </select>
          </Field>
          <p className="text-xs text-slate-500">{ACCESS_HINT[invite.access]} They'll get an email with a link to choose a password.</p>
        </div>
      </Modal>
    </Card>
  )
}
