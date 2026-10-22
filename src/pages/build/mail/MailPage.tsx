import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Inbox, PenLine, RefreshCw, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { clientLabel, contactName, listAllEmails, listProfiles, loadClientDirectory, mailboxStatus } from '../../../lib/api'
import { emailDayLabel, emailTimeLabel, parseEmailActivity, replySubject } from '../../../lib/emailActivity'
import { useLoad } from '../../../hooks/useLoad'
import { useAuth } from '../../../store/AuthContext'
import { useUnreadMail } from '../../../lib/unreadMail'
import { Button, Card, EmptyState, ErrorBanner, Spinner } from '../../../components/ui'
import { ComposeEmailModal } from '../../../components/email/ComposeEmailModal'
import { EmailActivityList } from '../../../components/email/EmailActivityList'
import type { Activity } from '../../../types'
import { paths } from '../paths'

type View = 'inbox' | 'unread' | 'sent' | 'all'
const VIEWS: { id: View; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'unread', label: 'Unread' },
  { id: 'sent', label: 'Sent' },
  { id: 'all', label: 'All' },
]

type Draft = { to?: string; subject?: string; body?: string; inReplyTo?: string | null; companyId?: string | null; contactId?: string | null }

/**
 * Mail: every client email in one place (Raptor's Mail item, second in the menu). Received mail
 * arrives here when a mailbox syncs and the sender is a known client; everything sent from Remus
 * is here too. Opening a message marks it read; Reply answers from your own mailbox.
 *
 * Raptor's full mail client (the whole mailbox, folders, reading pane, junk) is the next step; this
 * is the client mail it files, which is the part that belongs to Remus.
 */
export function MailPage() {
  const { currentUser } = useAuth()
  const unread = useUnreadMail()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>('inbox')
  const [everyone, setEveryone] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)

  const { data, error, loading, reload, setData } = useLoad(async () => {
    const [emails, dir, profiles, status] = await Promise.all([
      listAllEmails({ userId: everyone ? undefined : currentUser?.id }),
      loadClientDirectory(),
      listProfiles(),
      mailboxStatus().catch(() => null),
    ])
    return { emails, dir, profiles, status }
  }, [everyone, currentUser?.id], 'mail')

  // "+ Add → New email" in the top bar lands here with ?new=1.
  useEffect(() => {
    if (params.get('new') !== '1') return
    setDraft({})
    setParams((p) => { p.delete('new'); return p }, { replace: true })
  }, [params, setParams])

  // Reload when a sync files new mail (the envelope and the Sync button both trigger one).
  const wasSyncing = useRef(unread.syncing)
  useEffect(() => {
    if (wasSyncing.current && !unread.syncing) reload()
    wasSyncing.current = unread.syncing
  }, [unread.syncing, reload])

  const connected = data?.status?.connected ?? false
  const shown = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.emails.filter((a) => {
      const dir = parseEmailActivity(a.subject)?.direction ?? 'received'
      if (view === 'inbox' && dir !== 'received') return false
      if (view === 'unread' && !(dir === 'received' && a.is_read === false)) return false
      if (view === 'sent' && dir !== 'sent') return false
      if (!q) return true
      return [a.subject, a.notes, clientLabel(data.dir, a)].some((x) => x?.toLowerCase().includes(q))
    })
  }, [data, view, query])

  const counts = useMemo(() => {
    const received = (data?.emails ?? []).filter((a) => parseEmailActivity(a.subject)?.direction !== 'sent')
    return { inbox: received.length, unread: received.filter((a) => a.is_read === false).length }
  }, [data])

  function clientOf(a: Activity) {
    if (!data) return null
    const to = a.company_id ? paths.company(a.company_id) : a.contact_id ? paths.contact(a.contact_id) : null
    return to ? { label: clientLabel(data.dir, a), to } : null
  }

  function reply(a: Activity) {
    if (!data) return
    const person = a.contact_id ? data.dir.contactById.get(a.contact_id) : null
    const company = a.company_id ? data.dir.companyById.get(a.company_id) : null
    const quoted = (a.notes ?? '').split('\n').map((l) => `> ${l}`).join('\n')
    setDraft({
      to: person?.email ?? company?.email ?? undefined,
      subject: replySubject(parseEmailActivity(a.subject)?.subject ?? a.subject),
      body: `\n\nOn ${emailDayLabel(a.activity_date)} at ${emailTimeLabel(a.activity_date)}:\n${quoted}`,
      inReplyTo: a.email_message_id,
      companyId: a.company_id,
      contactId: a.contact_id,
    })
  }

  const recipients = useMemo(() => {
    if (!data) return []
    return [
      ...data.dir.companies.filter((c) => c.email).map((c) => ({ email: c.email!, label: c.name })),
      ...data.dir.contacts.filter((c) => c.email).map((c) => ({ email: c.email!, label: contactName(c) })),
    ]
  }, [data])

  if (loading && !data) return <Spinner page />

  return (
    <div className="space-y-4">
      <ErrorBanner error={error} />
      {data && !connected && (
        <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-slate-800">Connect your mailbox</p>
            <p className="text-sm text-slate-500">Then client emails land here and on each client's page, and you can send and reply from Remus.</p>
          </div>
          <Link to={paths.settings()} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-600">
            Go to Settings
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200/70">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                view === v.id ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {v.id === 'inbox' && <Inbox size={14} />}
              {v.label}
              {v.id === 'unread' && counts.unread > 0 && (
                <span className={clsx('rounded-full px-1.5 text-[11px] font-semibold', view === v.id ? 'bg-white/25' : 'bg-brand-100 text-brand-700')}>{counts.unread}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex w-full min-w-0 items-center gap-2 rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200/70 sm:w-64">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mail…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" />
          </label>
          <select
            value={everyone ? 'everyone' : 'mine'}
            onChange={(e) => setEveryone(e.target.value === 'everyone')}
            className="rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200/70"
            aria-label="Whose mail"
          >
            <option value="mine">My mailbox</option>
            <option value="everyone">Whole team</option>
          </select>
          {connected && (
            <Button size="md" onClick={() => void unread.sync()} loading={unread.syncing} title="Check your mailbox for new client mail">
              <RefreshCw size={14} /> Sync
            </Button>
          )}
          <Button variant="primary" onClick={() => setDraft({})} disabled={!connected} title={connected ? undefined : 'Connect your mailbox in Settings first'}>
            <PenLine size={14} /> New email
          </Button>
        </div>
      </div>

      <Card padded={false}>
        {shown.length === 0 ? (
          <EmptyState title={query ? 'Nothing matches that search' : view === 'unread' ? 'Nothing unread' : view === 'sent' ? 'Nothing sent yet' : 'No client mail yet'} icon={<Inbox size={28} />}>
            {!query && view !== 'sent' && 'Mail from addresses saved on a client lands here when your mailbox syncs. Add your clients’ email addresses to see their mail.'}
          </EmptyState>
        ) : (
          <EmailActivityList
            activities={shown}
            profiles={data?.profiles}
            onReply={connected ? reply : undefined}
            onChanged={(id, patch) => setData((d) => d && { ...d, emails: d.emails.map((a) => (a.id === id ? { ...a, ...patch } : a)) })}
            clientOf={clientOf}
            focusId={params.get('email')}
          />
        )}
      </Card>
      {data && (
        <p className="text-xs text-slate-400">
          {counts.inbox} received · {data.emails.length - counts.inbox} sent{everyone ? ' across the team' : ' in your mailbox'}. Only mail to and from clients is kept; the rest of your inbox stays private.
        </p>
      )}

      {draft && (
        <ComposeEmailModal
          open
          to={draft.to}
          recipients={recipients}
          initialSubject={draft.subject}
          initialBody={draft.body}
          inReplyTo={draft.inReplyTo}
          companyId={draft.companyId ?? null}
          contactId={draft.contactId ?? null}
          onClose={() => setDraft(null)}
          onSent={reload}
        />
      )}
    </div>
  )
}
