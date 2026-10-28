import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button, Card } from '../../../components/ui'
import { formatDate } from '../../../lib/format'
import { useAuth } from '../../../store/AuthContext'
import { fetchPortalContacts, invitePortalContact, setPortalContactActive, type PortalClient, type PortalContact } from '../../../lib/portalStaffApi'

/**
 * CLIENT PORTAL ACCESS (Remus · Handoff 5, Raptor H13's PortalAccessCard): which of the client's people
 * may sign in to the portal and follow their job, and the Invite that lets another one in. The invite
 * goes from the inviter's own mailbox.
 */
export function PortalAccessCard({ client, clientName, suggest }: {
  client: PortalClient
  clientName: string
  /** The client's own address, offered in the box when nobody has access yet. */
  suggest?: { email: string | null; name: string }
}) {
  const { currentUser } = useAuth()
  const allowed = !!currentUser && currentUser.role !== 'Read Only'
  const [contacts, setContacts] = useState<PortalContact[] | null>(null)
  const [email, setEmail] = useState(suggest?.email ?? '')
  const [name, setName] = useState(suggest?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = 'companyId' in client ? client.companyId : client.contactId

  const load = () => fetchPortalContacts(client).then(setContacts).catch((e: Error) => setError(e.message))
  useEffect(() => {
    if (allowed) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, allowed])

  if (!allowed) return null

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await invitePortalContact(client, email, name)
      setNote(r.emailed
        ? `Invited. ${email} has been emailed the link (${r.url}).`
        : `Access given, but the invitation could not be emailed (${r.emailError}). Send them ${r.url} yourself.`)
      setEmail(''); setName('')
      await load()
    } catch (x) { setError(x instanceof Error ? x.message : String(x)) } finally { setBusy(false) }
  }

  async function toggle(c: PortalContact) {
    setError(null)
    try { await setPortalContactActive(c.id, !c.active); await load() } catch (x) { setError(x instanceof Error ? x.message : String(x)) }
  }

  return (
    <Card
      title="Client portal"
      subtitle="Who may sign in and follow the job: where each stage stands, their quotes, and their invoices with what is paid. Never costs or profit."
      actions={<a href="/portal" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">What they see <ExternalLink size={12} /></a>}
    >
      <div data-testid="portal-access" className="pb-4">
        {contacts === null ? <p className="mt-2 text-sm text-slate-400">Reading…</p>
          : contacts.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nobody at {clientName} can sign in yet.</p>
            : (
              <ul className="mt-2 divide-y divide-slate-100">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm" data-testid="portal-contact">
                    <div className={`min-w-0 ${c.active ? '' : 'opacity-50'}`}>
                      <p className="truncate text-slate-800">{c.name || c.email}</p>
                      <p className="truncate text-xs text-slate-500">
                        {c.name ? `${c.email} · ` : ''}last signed in: {c.last_login_at ? formatDate(c.last_login_at) : 'never'}{c.active ? '' : ' · switched off'}
                      </p>
                    </div>
                    <button type="button" onClick={() => void toggle(c)} className="shrink-0 text-xs text-slate-600 underline">
                      {c.active ? 'Switch off' : 'Switch back on'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
        <form onSubmit={invite} className="mt-3 flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="input min-w-[8rem] flex-1" />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address"
            className="input min-w-[12rem] flex-[2]" data-testid="portal-invite-email" />
          <Button type="submit" variant="dark" loading={busy} disabled={!email}>Invite</Button>
        </form>
        {note && <p className="mt-2 text-sm text-emerald-700">{note}</p>}
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    </Card>
  )
}
