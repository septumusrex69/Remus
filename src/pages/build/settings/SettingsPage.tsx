import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { listProfiles, updateOwnProfile, updateSettings } from '../../../lib/api'
import { useLoad } from '../../../hooks/useLoad'
import { useAuth } from '../../../store/AuthContext'
import { Badge, Button, Card, ErrorBanner, Field, PageHeader } from '../../../components/ui'
import type { CompanySettings } from '../../../types'
import { useBuild } from '../BuildContext'
import { MailboxCard } from './MailboxCard'

export function SettingsPage() {
  const { settings, reloadSettings } = useBuild()
  const { currentUser } = useAuth()
  const [form, setForm] = useState<Partial<CompanySettings>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const team = useLoad(() => listProfiles())
  const [me, setMe] = useState({ name: '', phone: '', signature: '' })
  const [meSaved, setMeSaved] = useState(false)

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])
  useEffect(() => {
    if (currentUser) setMe({ name: currentUser.name, phone: currentUser.phone ?? '', signature: currentUser.email_signature ?? '' })
  }, [currentUser])

  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
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
        next_quote_number: Number(form.next_quote_number ?? 1),
        invoice_prefix: form.invoice_prefix || 'INV',
        next_invoice_number: Number(form.next_invoice_number ?? 1),
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
      await updateOwnProfile(currentUser.id, { name: me.name, phone: me.phone || null, email_signature: me.signature.trim() || null })
      team.reload()
      setMeSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        actions={<Button variant="primary" onClick={save} loading={saving}><Save size={15} /> {saved ? 'Saved' : 'Save settings'}</Button>}
      />
      <ErrorBanner error={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Company details (letterhead)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company name" className="sm:col-span-2"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Registration no."><input className="input" value={form.reg_no ?? ''} onChange={(e) => set('reg_no', e.target.value)} /></Field>
            <Field label="VAT no."><input className="input" value={form.vat_no ?? ''} onChange={(e) => set('vat_no', e.target.value)} /></Field>
            <Field label="Phone"><input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Address" className="sm:col-span-2"><textarea className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Logo URL" className="sm:col-span-2" hint="A public image URL shown on printed quotes."><input className="input" value={form.logo_url ?? ''} onChange={(e) => set('logo_url', e.target.value)} /></Field>
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
            <Field label="Email signature" className="sm:col-span-2" hint="Added under every email you send from Remus.">
              <textarea className="input min-h-24" value={me.signature} onChange={(e) => { setMe({ ...me, signature: e.target.value }); setMeSaved(false) }} placeholder={'Kind regards\nYour Name\n082 000 0000'} />
            </Field>
          </div>
          <Button className="mt-3" size="sm" onClick={saveMe}>{meSaved ? 'Saved' : 'Save profile'}</Button>
        </Card>
        <MailboxCard />
        <Card title="Team" padded={false}>
          <ul className="divide-y divide-slate-100">
            {(team.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: p.avatar_color }}>{(p.name || p.email).slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.name || '—'}</span><span className="block truncate text-xs text-slate-500">{p.email}</span></span>
                {p.status === 'Inactive' && <Badge>Inactive</Badge>}
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Add people from the Supabase dashboard (Authentication → Users → Invite). Everyone signed in can see and edit all company data.
          </p>
        </Card>
      </div>
    </div>
  )
}
