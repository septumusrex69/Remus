import { useEffect, useState, type FormEvent } from 'react'
import { Link2, Mail, RefreshCw, Unlink } from 'lucide-react'
import { connectMailbox, disconnectMailbox, mailboxStatus, syncMailbox, updateOwnProfile } from '../../../lib/api'
import { formatDateTime } from '../../../lib/format'
import { useAuth } from '../../../store/AuthContext'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, ErrorBanner, Field } from '../../../components/ui'

/**
 * Settings → My email: connect your own mailbox so quotes and client emails go out from your
 * address, with your signature, and land in your own Sent folder; and so clients' replies are
 * filed on their page (as in Raptor's EmailIntegrationCard).
 */

type Preset = 'own' | 'google' | 'microsoft'

const PRESETS: Record<Preset, { label: string; smtpHost: (domain: string) => string; smtpPort: number; imapHost: (domain: string) => string; imapPort: number; hint: string }> = {
  own: {
    label: 'Company domain (cPanel, Afrihost, Xneelo…)',
    smtpHost: (d) => (d ? `mail.${d}` : ''),
    smtpPort: 465,
    imapHost: (d) => (d ? `mail.${d}` : ''),
    imapPort: 993,
    hint: 'Your host lists these under Email Accounts → Connect Devices (or "Configure Mail Client"). Usually mail.yourdomain.co.za.',
  },
  google: {
    label: 'Gmail / Google Workspace',
    smtpHost: () => 'smtp.gmail.com',
    smtpPort: 465,
    imapHost: () => 'imap.gmail.com',
    imapPort: 993,
    hint: 'Use an app password, not your normal one: Google Account → Security → 2-Step Verification → App passwords.',
  },
  microsoft: {
    label: 'Microsoft 365 / Outlook',
    smtpHost: () => 'smtp.office365.com',
    smtpPort: 587,
    imapHost: () => 'outlook.office365.com',
    imapPort: 993,
    hint: 'Your Microsoft 365 admin may need to allow "Authenticated SMTP" and IMAP for your mailbox.',
  },
}

const empty = { email: '', password: '', smtpHost: '', smtpPort: '465', imapHost: '', imapPort: '993' }

export function MailboxCard() {
  const { currentUser, reloadProfile } = useAuth()
  const status = useLoad(() => mailboxStatus(), [], 'mailbox-status')
  const [showForm, setShowForm] = useState(false)
  const [preset, setPreset] = useState<Preset>('own')
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signature, setSignature] = useState('')
  const [signatureSaved, setSignatureSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  useEffect(() => {
    setSignature(currentUser?.email_signature ?? '')
  }, [currentUser])

  /** Fills the servers in from the preset and the address's domain, until someone types their own. */
  function applyPreset(p: Preset, email: string) {
    const domain = email.split('@')[1]?.trim().toLowerCase() ?? ''
    const x = PRESETS[p]
    setForm((f) => ({ ...f, email, smtpHost: x.smtpHost(domain), smtpPort: String(x.smtpPort), imapHost: x.imapHost(domain), imapPort: String(x.imapPort) }))
  }

  function openForm() {
    setShowForm(true)
    setError(null)
    applyPreset(preset, currentUser?.email ?? '')
  }

  async function connect(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await connectMailbox({
        email: form.email.trim(),
        password: form.password,
        smtpHost: form.smtpHost.trim(),
        smtpPort: Number(form.smtpPort),
        imapHost: form.imapHost.trim(),
        imapPort: Number(form.imapPort),
      })
      setShowForm(false)
      setForm(empty)
      status.reload()
      // First look at the mailbox straight away, so the client pages fill without waiting a day.
      void sync()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function sync() {
    setSyncing(true)
    setError(null)
    setSyncNote(null)
    try {
      const r = await syncMailbox()
      setSyncNote(r.logged === 0 ? 'Up to date: no new mail from clients.' : `${r.logged} new email${r.logged === 1 ? '' : 's'} filed on client pages.`)
      status.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect your mailbox? Quotes will go out from the company address instead, if one is set up.')) return
    try {
      await disconnectMailbox()
      status.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveSignature() {
    if (!currentUser) return
    try {
      await updateOwnProfile(currentUser.id, { email_signature: signature.trim() || null })
      reloadProfile()
      setSignatureSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const connected = status.data?.connected
  return (
    <Card title="My email">
      <ErrorBanner error={error ?? status.error} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Mail size={16} /></div>
          <p className="text-sm text-slate-600">
            {status.loading && !status.data
              ? 'Checking…'
              : connected
                ? <>Quotes and emails you send go out from <span className="font-medium text-slate-800">{status.data?.email}</span>, and a copy lands in your Sent folder. Mail from clients is filed on their page once a day, or when you sync.</>
                : 'Connect your own mailbox so quotes and emails go out from your address, with your signature, and clients’ replies show on their page.'}
          </p>
        </div>
        {connected ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={sync} loading={syncing}><RefreshCw size={14} /> Sync</Button>
            <Button size="sm" variant="danger" onClick={disconnect}><Unlink size={14} /> Disconnect</Button>
          </div>
        ) : (
          !showForm && !status.loading && <Button size="sm" onClick={openForm}><Link2 size={14} /> Connect</Button>
        )}
      </div>

      {connected && (
        <p className="mt-2 text-xs text-slate-500">
          {syncNote ?? `Last synced ${status.data?.lastSyncedAt ? formatDateTime(status.data.lastSyncedAt) : 'never'}.`} Only mail from addresses saved on a client is filed; the rest of your inbox stays private.
        </p>
      )}

      {showForm && !connected && (
        <form onSubmit={connect} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
          <Field label="Email provider" className="sm:col-span-2" hint={PRESETS[preset].hint}>
            <select
              className="input"
              value={preset}
              onChange={(e) => {
                const p = e.target.value as Preset
                setPreset(p)
                applyPreset(p, form.email)
              }}
            >
              {(Object.keys(PRESETS) as Preset[]).map((p) => <option key={p} value={p}>{PRESETS[p].label}</option>)}
            </select>
          </Field>
          <Field label="Email address">
            <input className="input" type="email" required value={form.email} onChange={(e) => applyPreset(preset, e.target.value)} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" required autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Outgoing server (SMTP)">
            <input className="input" required value={form.smtpHost} onChange={(e) => setForm({ ...form, smtpHost: e.target.value })} placeholder="mail.yourdomain.co.za" />
          </Field>
          <Field label="SMTP port">
            <input className="input" type="number" required value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: e.target.value })} />
          </Field>
          <Field label="Incoming server (IMAP)">
            <input className="input" required value={form.imapHost} onChange={(e) => setForm({ ...form, imapHost: e.target.value })} placeholder="mail.yourdomain.co.za" />
          </Field>
          <Field label="IMAP port">
            <input className="input" type="number" required value={form.imapPort} onChange={(e) => setForm({ ...form, imapPort: e.target.value })} />
          </Field>
          <p className="text-xs text-slate-500 sm:col-span-2">Remus logs in once to check these work, then stores the password encrypted. Nobody, administrators included, can read it back.</p>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" size="sm" loading={busy}>{busy ? 'Checking…' : 'Connect mailbox'}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setShowForm(false); setError(null) }}>Cancel</Button>
          </div>
        </form>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <Field label="Signature" hint="Added under every quote and email you send from your own mailbox.">
          <textarea
            className="input min-h-24"
            value={signature}
            onChange={(e) => { setSignature(e.target.value); setSignatureSaved(false) }}
            placeholder={'Kind regards\nYour name\nYour company · 082 000 0000'}
          />
        </Field>
        <Button className="mt-2" size="sm" onClick={saveSignature}>{signatureSaved ? 'Saved' : 'Save signature'}</Button>
      </div>
    </Card>
  )
}
