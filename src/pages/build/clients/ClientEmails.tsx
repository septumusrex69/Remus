import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Plus, RefreshCw } from 'lucide-react'
import { contactName, listClientEmails, listProfiles, mailboxStatus, syncMailbox } from '../../../lib/api'
import { emailDayLabel, emailTimeLabel, parseEmailActivity, replySubject } from '../../../lib/emailActivity'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, Spinner } from '../../../components/ui'
import { ComposeEmailModal } from '../../../components/email/ComposeEmailModal'
import { EmailActivityList } from '../../../components/email/EmailActivityList'
import type { Activity, Company, Contact } from '../../../types'
import { paths } from '../paths'

type Draft = { to?: string; subject?: string; body?: string; inReplyTo?: string | null; contactId?: string | null }

/**
 * Every email to and from one client, as on Raptor's client page. Received mail lands here when
 * someone's connected mailbox syncs and the sender's address matches this company, one of its
 * people, or a thread Remus sent.
 */
export function ClientEmails({ company, contact, people }: { company: Company | null; contact: Contact | null; people: Contact[] }) {
  const contactIds = contact ? [contact.id] : people.map((p) => p.id)
  const { data, error, loading, reload, setData } = useLoad(async () => {
    const [emails, profiles, status] = await Promise.all([
      listClientEmails({ companyId: company?.id, contactIds }),
      listProfiles(),
      mailboxStatus().catch(() => null),
    ])
    return { emails, profiles, status }
  }, [company?.id, contact?.id, contactIds.join(',')], 'client-emails')

  const [draft, setDraft] = useState<Draft | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const recipients = [
    ...(company?.email ? [{ email: company.email, label: company.name }] : []),
    ...(contact?.email ? [{ email: contact.email, label: contactName(contact) }] : []),
    ...people.filter((p) => p.email).map((p) => ({ email: p.email!, label: contactName(p) })),
  ]

  function reply(a: Activity) {
    const parsed = parseEmailActivity(a.subject)
    const person = [contact, ...people].find((p) => p && p.id === a.contact_id)
    const quoted = (a.notes ?? '').split('\n').map((l) => `> ${l}`).join('\n')
    setDraft({
      to: person?.email ?? company?.email ?? recipients[0]?.email,
      subject: replySubject(parsed?.subject ?? a.subject),
      body: `\n\nOn ${emailDayLabel(a.activity_date)} at ${emailTimeLabel(a.activity_date)}:\n${quoted}`,
      inReplyTo: a.email_message_id,
      contactId: a.contact_id ?? contact?.id ?? null,
    })
  }

  async function sync() {
    setSyncing(true)
    setSyncNote(null)
    setSyncError(null)
    try {
      const r = await syncMailbox()
      setSyncNote(r.logged === 0 ? 'Up to date.' : `${r.logged} new email${r.logged === 1 ? '' : 's'} filed.`)
      reload()
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  const emails = data?.emails ?? []
  const unread = emails.filter((a) => a.is_read === false && parseEmailActivity(a.subject)?.direction !== 'sent').length
  const connected = data?.status?.connected ?? false

  return (
    <Card
      title={<span className="inline-flex items-center gap-2"><Mail size={15} className="text-slate-400" /> Emails{unread > 0 && <span className="rounded-full bg-brand-100 px-1.5 text-xs text-brand-800">{unread} unread</span>}</span>}
      padded={false}
      actions={
        <>
          {connected && <Button size="sm" variant="ghost" onClick={sync} loading={syncing} title="Check your mailbox for new mail"><RefreshCw size={13} /> Sync</Button>}
          <Button size="sm" variant="dark" onClick={() => setDraft({})} disabled={!connected} title={connected ? undefined : 'Connect your mailbox in Settings first'}><Plus size={13} /> Email</Button>
        </>
      }
    >
      {(error || syncError) && <div className="px-4 pt-3"><ErrorBanner error={error ?? syncError} /></div>}
      {syncNote && <p className="px-4 pt-2 text-xs text-slate-500">{syncNote}</p>}
      {data && !connected && (
        <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          Connect your mailbox in <Link to={paths.settings()} className="font-medium text-brand-700 hover:underline">Settings</Link> to send email from Remus and see this client's replies here.
        </p>
      )}
      {loading && !data ? (
        <Spinner />
      ) : emails.length === 0 ? (
        <EmptyState title="No emails yet">
          Emails you send from here, and mail from {recipients.length ? 'this client’s addresses' : 'this client (add an email address first)'}, show up here.
        </EmptyState>
      ) : (
        <div className="max-h-[36rem] overflow-y-auto">
          <EmailActivityList
            activities={emails}
            profiles={data?.profiles}
            onReply={connected ? reply : undefined}
            onChanged={(id, patch) => setData((d) => d && { ...d, emails: d.emails.map((a) => (a.id === id ? { ...a, ...patch } : a)) })}
          />
        </div>
      )}
      {draft && (
        <ComposeEmailModal
          open
          to={draft.to}
          recipients={recipients}
          initialSubject={draft.subject}
          initialBody={draft.body}
          inReplyTo={draft.inReplyTo}
          companyId={company?.id ?? contact?.company_id ?? null}
          contactId={draft.contactId ?? contact?.id ?? null}
          onClose={() => setDraft(null)}
          onSent={reload}
        />
      )}
    </Card>
  )
}
