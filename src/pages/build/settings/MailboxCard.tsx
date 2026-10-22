import { useState, type FormEvent } from 'react'
import { Mail, RefreshCw, Unplug } from 'lucide-react'
import { connectEmail, disconnectEmail, emailStatus, syncEmail } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { Badge, Button, Card, ErrorBanner, Field, Spinner } from '../../../components/ui'

const EMPTY = { email: '', password: '', smtpHost: '', smtpPort: '465', imapHost: '', imapPort: '993' }

/**
 * Connects the signed-in person's own mailbox over SMTP/IMAP, as Raptor's Settings →
 * Integrations does. Sending goes out from this mailbox; incoming mail from known clients is
 * filed on their page (daily automatically, or on "Sync now").
 */
export function MailboxCard() {
  const status = useLoad(() => emailStatus())
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function run(kind: 'connect' | 'sync' | 'disconnect', fn: () => Promise<string | null>) {
    setBusy(kind)
    setError(null)
    setNote(null)
    try {
      setNote(await fn())
      status.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function connect(e: FormEvent) {
    e.preventDefault()
    void run('connect', async () => {
      await connectEmail({
        email: form.email.trim(),
        password: form.password,
        smtpHost: form.smtpHost.trim(),
        smtpPort: Number(form.smtpPort),
        imapHost: form.imapHost.trim(),
        imapPort: Number(form.imapPort),
      })
      setForm(EMPTY)
      const r = await syncEmail().catch(() => null)
      return r ? `Connected. ${r.logged} email${r.logged === 1 ? '' : 's'} from known clients filed.` : 'Connected.'
    })
  }

  const s = status.data
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Mail size={15} className="text-slate-400" /> My mailbox</span>}>
      <ErrorBanner error={error ?? (status.error && !s ? status.error : null)} />
      {note && <p className="mb-3 text-sm text-emerald-700">{note}</p>}
      {status.loading && !s ? (
        <Spinner />
      ) : s?.connected ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="bg-emerald-50 text-emerald-700">Connected</Badge>
            <span className="text-sm font-medium text-slate-800">{s.email}</span>
          </div>
          <p className="text-xs text-slate-500">
            Last synced {s.lastSyncedAt ? formatDateTime(s.lastSyncedAt) : 'never'}. New mail from clients is filed automatically once a day; use Sync now to fetch it straight away.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void run('sync', async () => { const r = await syncEmail(); return r.logged === 0 ? 'Up to date.' : `${r.logged} new email${r.logged === 1 ? '' : 's'} filed.` })} loading={busy === 'sync'}>
              <RefreshCw size={13} /> Sync now
            </Button>
            <Button size="sm" variant="danger" onClick={() => window.confirm('Disconnect this mailbox? Emails already filed stay on the client pages.') && void run('disconnect', async () => { await disconnectEmail(); return 'Disconnected.' })} loading={busy === 'disconnect'}>
              <Unplug size={13} /> Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={connect} className="grid gap-3 sm:grid-cols-2">
          <p className="text-xs text-slate-500 sm:col-span-2">
            Connect your work mailbox to email clients from their page and see their replies there. Find the SMTP and IMAP settings in your email host's control panel (cPanel → Email Accounts → Connect Devices). Only mail from addresses saved on a client is filed; everything else stays private.
          </p>
          <Field label="Email address"><input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></Field>
          <Field label="Password"><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} required /></Field>
          <Field label="SMTP host (outgoing)"><input className="input" placeholder="mail.yourdomain.co.za" value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} required /></Field>
          <Field label="SMTP port" hint="465 (SSL) or 587"><input className="input" type="number" value={form.smtpPort} onChange={(e) => set('smtpPort', e.target.value)} required /></Field>
          <Field label="IMAP host (incoming)"><input className="input" placeholder="mail.yourdomain.co.za" value={form.imapHost} onChange={(e) => set('imapHost', e.target.value)} required /></Field>
          <Field label="IMAP port" hint="Usually 993"><input className="input" type="number" value={form.imapPort} onChange={(e) => set('imapPort', e.target.value)} required /></Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="dark" size="sm" loading={busy === 'connect'}>Connect mailbox</Button>
            <p className="mt-2 text-xs text-slate-500">The login is checked before it is saved, and the password is stored encrypted. Nobody, including admins, can read it back.</p>
          </div>
        </form>
      )}
    </Card>
  )
}
