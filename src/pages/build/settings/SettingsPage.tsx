import { useEffect, useRef, useState } from 'react'
import { ImageUp, Save } from 'lucide-react'
import { updateOwnProfile, updateSettings, uploadLogo } from '../../../lib/api'
import { useAuth } from '../../../store/AuthContext'
import { Button, Card, ErrorBanner, Field, PageHeader } from '../../../components/ui'
import type { CompanySettings } from '../../../types'
import { useBuild } from '../BuildContext'
import { TeamCard } from './TeamCard'
import { ConnectorCard } from './ConnectorCard'
import { AppearanceCard } from './AppearanceCard'
import { MailboxCard } from './MailboxCard'

export function SettingsPage() {
  const { settings, reloadSettings } = useBuild()
  const { currentUser, reloadProfile } = useAuth()
  const [form, setForm] = useState<Partial<CompanySettings>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState({ name: '', phone: '' })
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)

  // Settings in context were loaded when the app opened; quotes and invoices created since have
  // moved the counters on, so fetch a fresh copy before editing.
  useEffect(() => {
    reloadSettings()
  }, [reloadSettings])
  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])
  useEffect(() => {
    if (currentUser) setMe({ name: currentUser.name, phone: currentUser.phone ?? '' })
  }, [currentUser])

  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setSaved(false)
  }

  async function save() {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      // Send the counters only when someone changed them here; otherwise a stale copy would
      // rewind them and the next quote or invoice would reuse a number.
      const counters: Partial<CompanySettings> = {}
      if (Number(form.next_quote_number) !== settings.next_quote_number) counters.next_quote_number = Math.max(1, Number(form.next_quote_number) || 1)
      if (Number(form.next_invoice_number) !== settings.next_invoice_number) counters.next_invoice_number = Math.max(1, Number(form.next_invoice_number) || 1)
      await updateSettings({
        name: form.name ?? '',
        reg_no: form.reg_no || null,
        vat_no: form.vat_no || null,
        address: form.address || null,
        phone: form.phone || null,
        email: form.email || null,
        logo_url: form.logo_url || null,
        vat_rate: Number(form.vat_rate ?? 15),
        quote_terms: form.quote_terms || null,
        bank_details: form.bank_details || null,
        quote_prefix: form.quote_prefix || 'Q',
        invoice_prefix: form.invoice_prefix || 'INV',
        ...counters,
      })
      reloadSettings()
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function saveMe() {
    if (!currentUser) return
    try {
      await updateOwnProfile(currentUser.id, { name: me.name, phone: me.phone || null })
      reloadProfile()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onLogo(file: File | undefined) {
    if (!file) return
    setUploadingLogo(true)
    setError(null)
    try {
      set('logo_url', await uploadLogo(file))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploadingLogo(false)
      if (logoInput.current) logoInput.current.value = ''
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        actions={<Button variant="primary" onClick={save} loading={saving} disabled={!settings}><Save size={15} /> {saved ? 'Saved' : 'Save settings'}</Button>}
      />
      <ErrorBanner error={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AppearanceCard />
        <Card title="Company details (letterhead)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company name" className="sm:col-span-2"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Registration no."><input className="input" value={form.reg_no ?? ''} onChange={(e) => set('reg_no', e.target.value)} /></Field>
            <Field label="VAT no."><input className="input" value={form.vat_no ?? ''} onChange={(e) => set('vat_no', e.target.value)} /></Field>
            <Field label="Phone"><input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Address" className="sm:col-span-2"><textarea className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Logo" className="sm:col-span-2" hint="Shown on printed quotes, quote PDFs and emails. PNG or JPG, up to 2 MB.">
              <div className="flex flex-wrap items-center gap-3">
                {form.logo_url && <img src={form.logo_url} alt="Logo" className="h-12 max-w-40 rounded border border-slate-200 bg-white object-contain p-1" />}
                <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
                <Button size="sm" onClick={() => logoInput.current?.click()} loading={uploadingLogo}><ImageUp size={14} /> {form.logo_url ? 'Replace logo' : 'Upload logo'}</Button>
                {form.logo_url && <Button size="sm" variant="ghost" onClick={() => set('logo_url', null)}>Remove</Button>}
              </div>
              <input className="input mt-2" value={form.logo_url ?? ''} onChange={(e) => set('logo_url', e.target.value)} placeholder="…or paste a public image URL" />
            </Field>
          </div>
        </Card>
        <Card title="Tax & numbering">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="VAT rate (%)" hint="Default for new quotes, invoices and slips."><input className="input" type="number" step="0.01" value={form.vat_rate ?? 15} onChange={(e) => set('vat_rate', Number(e.target.value))} /></Field>
            <div />
            <Field label="Quote prefix"><input className="input" value={form.quote_prefix ?? 'Q'} onChange={(e) => set('quote_prefix', e.target.value)} /></Field>
            <Field label="Next quote number"><input className="input" type="number" min={1} value={form.next_quote_number ?? 1} onChange={(e) => set('next_quote_number', Number(e.target.value))} /></Field>
            <Field label="Invoice prefix"><input className="input" value={form.invoice_prefix ?? 'INV'} onChange={(e) => set('invoice_prefix', e.target.value)} /></Field>
            <Field label="Next invoice number"><input className="input" type="number" min={1} value={form.next_invoice_number ?? 1} onChange={(e) => set('next_invoice_number', Number(e.target.value))} /></Field>
          </div>
        </Card>
        <Card title="Default quote terms">
          <textarea className="input min-h-40" value={form.quote_terms ?? ''} onChange={(e) => set('quote_terms', e.target.value)} placeholder={'e.g. 50% deposit on acceptance, balance on completion.\nQuote valid for 30 days.'} />
        </Card>
        <Card title="Bank details (shown on quotes)">
          <textarea className="input min-h-40" value={form.bank_details ?? ''} onChange={(e) => set('bank_details', e.target.value)} placeholder={'Bank: FNB\nAccount name: …\nAccount no: …\nBranch code: 250655'} />
        </Card>
        <Card title="My profile">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><input className="input" value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={me.phone} onChange={(e) => setMe({ ...me, phone: e.target.value })} /></Field>
          </div>
          <Button className="mt-3" size="sm" onClick={saveMe}>Save profile</Button>
        </Card>
        <MailboxCard />
        <TeamCard />
        <ConnectorCard />
      </div>
    </div>
  )
}
