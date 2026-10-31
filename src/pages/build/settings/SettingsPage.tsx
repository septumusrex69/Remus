import { useEffect, useRef, useState } from 'react'
import { seesMoney, useAccess } from '../../../lib/access'
import { NumInput } from '../../../components/ui/NumInput'
import { useSearchParams } from 'react-router-dom'
import { ImageUp, PanelLeftClose, PanelLeftOpen, Save } from 'lucide-react'
import { updateOwnProfile, updateSettings, uploadLogo } from '../../../lib/api'
import { useAuth } from '../../../store/AuthContext'
import { Button, Card, ErrorBanner, Field } from '../../../components/ui'
import type { CompanySettings } from '../../../types'
import { useSettingsNavCollapsed } from '../../../lib/sidebarCollapsed'
import { useBuild } from '../BuildContext'
import { TeamCard } from './TeamCard'
import { ClaudeCreditCard } from './ClaudeCreditCard'
import { ConnectorCard } from './ConnectorCard'
import { AppearanceCard } from './AppearanceCard'
import { MailboxCard } from './MailboxCard'
import { MyStoresCard } from './MyStoresCard'

/**
 * Settings, laid out the way Raptor lays out its own (src/pages/settings/SettingsPage.tsx): a menu
 * of tabs down the left that folds away, one tab at a time on the right, and each tab a titled
 * card with its own Save. Stephan, of the old page: "it's confusing, it's all over the place" --
 * nine cards in one grid, one Save button at the top that saved some of them and not others.
 *
 * The tab is in the URL (?tab=Integrations), Raptor's rule, so another screen can send somebody
 * straight to it: "connect your mailbox" on the Mail page and on a client's Emails card does.
 */
const TABS = ['Profile', 'Appearance', 'Users', 'Company', 'Quotes & Invoices', 'My stores', 'Integrations'] as const
type Tab = (typeof TABS)[number]

const isTab = (v: string | null): v is Tab => TABS.includes((v ?? '') as Tab)
/** The company's letterhead, bank details, rates and markup, and its stores: Administrators' (lib/access.ts). */
const MONEY_TABS: Tab[] = ['Company', 'Quotes & Invoices', 'My stores']

export function SettingsPage() {
  const [navCollapsed, toggleNav] = useSettingsNavCollapsed()
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get('tab')
  const money = seesMoney(useAccess())
  const tabs = TABS.filter((t) => money || !MONEY_TABS.includes(t))
  const tab: Tab = isTab(fromUrl) && tabs.includes(fromUrl) ? fromUrl : 'Profile'

  /* Replace, not push (Raptor): six tabs clicked in a row should not mean six taps of Back. */
  const setTab = (next: Tab) => {
    const keep = new URLSearchParams(params)
    keep.set('tab', next)
    setParams(keep, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      {!navCollapsed && (
        <nav className="shrink-0 md:w-52">
          {/* On a phone the menu is a dropdown above the tab: a row scrolling sideways hid half the
              tabs off the edge, and a column would eat half the screen. */}
          <label className="flex items-center gap-2 md:hidden">
            <span className="text-sm font-medium text-slate-500">Settings:</span>
            <select className="input flex-1 font-medium" value={tab} onChange={(e) => setTab(e.target.value as (typeof TABS)[number])} aria-label="Settings section">
              {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div className="hidden md:block md:space-y-0.5">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-current={tab === t ? 'page' : undefined}
                className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm font-medium whitespace-nowrap md:w-full ${
                  tab === t ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={toggleNav}
            aria-expanded="true"
            title="Narrow the settings menu"
            className="mt-2 hidden w-full items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:flex"
          >
            <PanelLeftClose size={15} /> Narrow this menu
          </button>
        </nav>
      )}
      <div className="min-w-0 flex-1">
        {/* Folded, the strip carries the tab's name: both where you are and the way back. */}
        {navCollapsed && (
          <button
            type="button"
            onClick={toggleNav}
            aria-expanded="false"
            title="Show the settings menu"
            className="-mt-1 mb-3 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <PanelLeftOpen size={15} /> {tab}
          </button>
        )}
        {tab === 'Profile' && <ProfileTab />}
        {tab === 'Appearance' && <AppearanceCard />}
        {tab === 'Users' && <TeamCard />}
        {tab === 'Company' && <CompanyTab />}
        {tab === 'Quotes & Invoices' && <QuotesTab />}
        {tab === 'My stores' && <div className="max-w-3xl"><MyStoresCard /></div>}
        {tab === 'Integrations' && (
          <div className="grid gap-4 xl:grid-cols-2">
            <MailboxCard />
            {money && <ConnectorCard />}
            {money && <ClaudeCreditCard />}
          </div>
        )}
      </div>
    </div>
  )
}

/** "Saved" for two seconds after a save, Raptor's way: long enough to see, gone before it misleads. */
function useFlash(): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [on, () => {
    setOn(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOn(false), 2000)
  }]
}

function ProfileTab() {
  const { currentUser, reloadProfile } = useAuth()
  const [me, setMe] = useState({ name: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const [saved, flash] = useFlash()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (currentUser) setMe({ name: currentUser.name, phone: currentUser.phone ?? '' })
  }, [currentUser])

  async function save() {
    if (!currentUser) return
    setSaving(true)
    setError(null)
    try {
      await updateOwnProfile(currentUser.id, { name: me.name, phone: me.phone || null })
      reloadProfile()
      flash()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const name = me.name || currentUser?.email || ''
  return (
    <Card title="Profile" subtitle="Your own account. Your email signature is with your mailbox, under Integrations.">
      <ErrorBanner error={error} />
      <div className="mb-6 flex items-center gap-4">
        <span
          className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-semibold text-white"
          style={{ background: currentUser?.avatar_color ?? 'var(--color-slate-600)' }}
        >
          {(name || '?').slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="font-semibold text-slate-800">{currentUser?.name || name}</p>
          <p className="text-sm text-slate-400">{currentUser?.role}</p>
        </div>
      </div>
      <SectionLabel>Personal information</SectionLabel>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Full name"><input className="input" value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={me.phone} onChange={(e) => setMe({ ...me, phone: e.target.value })} /></Field>
        <Field label="Email" hint="Your sign-in. An administrator can change it."><input className="input" value={currentUser?.email ?? ''} disabled /></Field>
        <Field label="Role"><input className="input" value={currentUser?.role ?? ''} disabled /></Field>
      </div>
      <SaveRow onSave={save} saving={saving} saved={saved} label="Save profile" />
    </Card>
  )
}

/**
 * The company's letterhead and its quote/invoice settings are one row in the database
 * (company_settings) shown on two tabs. Each tab saves only its own fields, so a stale copy on one
 * can never overwrite what somebody just changed on the other.
 */
function useCompanyForm() {
  const { settings, reloadSettings } = useBuild()
  const [form, setForm] = useState<Partial<CompanySettings>>({})
  const [saving, setSaving] = useState(false)
  const [saved, flash] = useFlash()
  const [error, setError] = useState<string | null>(null)

  // Settings in context were loaded when the app opened; quotes and invoices created since have
  // moved the counters on, so fetch a fresh copy before editing.
  useEffect(() => {
    reloadSettings()
  }, [reloadSettings])
  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  const set = <K extends keyof CompanySettings>(k: K, v: CompanySettings[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save(values: Partial<CompanySettings>) {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      await updateSettings(values)
      reloadSettings()
      flash()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return { settings, form, set, save, saving, saved, error, setError }
}

function CompanyTab() {
  const { settings, form, set, save, saving, saved, error, setError } = useCompanyForm()
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)

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
    <Card title="Company" subtitle="Your letterhead: printed on quotes and invoices, and shown on quote PDFs and emails.">
      <ErrorBanner error={error} />
      <SectionLabel>Company details</SectionLabel>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Company name" className="sm:col-span-2"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Registration no."><input className="input" value={form.reg_no ?? ''} onChange={(e) => set('reg_no', e.target.value)} /></Field>
        <Field label="VAT no."><input className="input" value={form.vat_no ?? ''} onChange={(e) => set('vat_no', e.target.value)} /></Field>
        <Field label="Phone"><input className="input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><textarea className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
      </div>

      <SectionLabel className="mt-6">How much work we take on</SectionLabel>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        {/* Remus · Handover 6: the jobs calendar on the Schedule page warns when a week has more running than this. */}
        <Field label="Jobs we can run at once" hint="The Schedule's jobs calendar shows a week as full at this number, and warns above it.">
          <NumInput value={form.max_jobs ?? 4} onValue={(n) => set('max_jobs', n)} />
        </Field>
      </div>

      <SectionLabel className="mt-6">Logo</SectionLabel>
      <div className="max-w-2xl">
        <p className="mb-3 text-xs text-slate-400">Shown on printed quotes, quote PDFs and emails. PNG or JPG, up to 2 MB. This is the company's logo; the app's own look is under Appearance.</p>
        <div className="flex flex-wrap items-center gap-3">
          {form.logo_url && <img src={form.logo_url} alt="Logo" className="h-12 max-w-40 rounded border border-slate-200 bg-white object-contain p-1" />}
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
          <Button size="sm" onClick={() => logoInput.current?.click()} loading={uploadingLogo}><ImageUp size={14} /> {form.logo_url ? 'Replace logo' : 'Upload logo'}</Button>
          {form.logo_url && <Button size="sm" variant="ghost" onClick={() => set('logo_url', null)}>Remove</Button>}
        </div>
        <input className="input mt-2" value={form.logo_url ?? ''} onChange={(e) => set('logo_url', e.target.value)} placeholder="…or paste a public image URL" />
      </div>

      <SaveRow
        disabled={!settings}
        saving={saving}
        saved={saved}
        onSave={() =>
          save({
            name: form.name ?? '',
            reg_no: form.reg_no || null,
            vat_no: form.vat_no || null,
            address: form.address || null,
            phone: form.phone || null,
            email: form.email || null,
            logo_url: form.logo_url || null,
            max_jobs: Math.min(50, Math.max(1, Math.round(Number(form.max_jobs) || 4))),
          })
        }
      />
    </Card>
  )
}

function QuotesTab() {
  const { settings, form, set, save, saving, saved, error } = useCompanyForm()

  function onSave() {
    if (!settings) return
    // Send the counters only when someone changed them here; otherwise a stale copy would
    // rewind them and the next quote or invoice would reuse a number.
    const counters: Partial<CompanySettings> = {}
    if (Number(form.next_quote_number) !== settings.next_quote_number) counters.next_quote_number = Math.max(1, Number(form.next_quote_number) || 1)
    if (Number(form.next_invoice_number) !== settings.next_invoice_number) counters.next_invoice_number = Math.max(1, Number(form.next_invoice_number) || 1)
    void save({
      vat_rate: Number(form.vat_rate ?? 15),
      vat_registered: form.vat_registered ?? true,
      quote_terms: form.quote_terms || null,
      bank_details: form.bank_details || null,
      quote_prefix: form.quote_prefix || 'Q',
      invoice_prefix: form.invoice_prefix || 'INV',
      labour_day_rate_senior: Math.max(0, Number(form.labour_day_rate_senior) || 0),
      labour_day_rate_junior: Math.max(0, Number(form.labour_day_rate_junior) || 0),
      markup_material: Number(form.markup_material) || 0,
      markup_labour: Number(form.markup_labour) || 0,
      markup_subcontractor: Number(form.markup_subcontractor) || 0,
      management_fee_pct: Math.min(100, Math.max(0, Number(form.management_fee_pct) || 0)),
      plan_disclaimer: (form.plan_disclaimer ?? '').trim() || 'This timeline is an estimate and may change.',
      ...counters,
    })
  }

  return (
    <Card title="Quotes & Invoices" subtitle="VAT, numbering, labour rates, markups, and what every new quote says at the bottom.">
      <ErrorBanner error={error} />
      <SectionLabel>Tax & numbering</SectionLabel>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2.5 sm:col-span-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]" checked={form.vat_registered ?? true} onChange={(e) => set('vat_registered', e.target.checked)} />
          <span>
            <span className="block text-sm font-medium text-slate-700">Registered for VAT</span>
            <span className="block text-xs text-slate-500">
              {form.vat_registered ?? true
                ? 'New quotes and invoices charge VAT at the rate below, and slips split the VAT out (you claim it back).'
                : 'Not registered: new quotes and invoices charge no VAT, and slips are costed at the full amount paid (the VAT can\'t be claimed back). Tick this the day you register.'}
            </span>
          </span>
        </label>
        <Field label="VAT rate (%)" hint={form.vat_registered ?? true ? 'Default for new quotes, invoices and slips.' : 'Used once you are registered.'}>
          <NumInput suffix="%" value={form.vat_rate ?? 15} onValue={(n) => set('vat_rate', n)} />
        </Field>
        <div className="hidden sm:block" />
        <Field label="Quote prefix"><input className="input" value={form.quote_prefix ?? 'Q'} onChange={(e) => set('quote_prefix', e.target.value)} /></Field>
        <Field label="Next quote number"><NumInput inputMode="numeric" value={form.next_quote_number ?? 1} onValue={(n) => set('next_quote_number', n)} /></Field>
        <Field label="Invoice prefix"><input className="input" value={form.invoice_prefix ?? 'INV'} onChange={(e) => set('invoice_prefix', e.target.value)} /></Field>
        <Field label="Next invoice number"><NumInput inputMode="numeric" value={form.next_invoice_number ?? 1} onValue={(n) => set('next_invoice_number', n)} /></Field>
      </div>

      <SectionLabel className="mt-6">Labour and markup</SectionLabel>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="Senior worker, cost per day (R)" hint="What a senior worker costs you for one day. Labour lines on quotes start from it.">
          <NumInput prefix="R" value={form.labour_day_rate_senior ?? 0} onValue={(n) => set('labour_day_rate_senior', n)} />
        </Field>
        <Field label="Junior worker, cost per day (R)">
          <NumInput prefix="R" value={form.labour_day_rate_junior ?? 0} onValue={(n) => set('labour_day_rate_junior', n)} />
        </Field>
        <Field label="Markup on materials (%)" hint="Starting markup for a new line of each kind.">
          <NumInput suffix="%" value={form.markup_material ?? 20} onValue={(n) => set('markup_material', n)} />
        </Field>
        <Field label="Markup on labour (%)">
          <NumInput suffix="%" value={form.markup_labour ?? 20} onValue={(n) => set('markup_labour', n)} />
        </Field>
        <Field label="Markup on subcontractors (%)">
          <NumInput suffix="%" value={form.markup_subcontractor ?? 10} onValue={(n) => set('markup_subcontractor', n)} />
        </Field>
        <Field label="Management fee (%)" hint="Shown on the quote as its own line. Default for new quotes.">
          <NumInput suffix="%" value={form.management_fee_pct ?? 0} onValue={(n) => set('management_fee_pct', n)} />
        </Field>
      </div>

      <SectionLabel className="mt-6">Estimated timeline clause</SectionLabel>
      <p className="mb-2 max-w-2xl text-xs text-slate-500">Printed under the estimated timeline on every quote that shows one.</p>
      <textarea className="input min-h-24 max-w-2xl" value={form.plan_disclaimer ?? ''} onChange={(e) => set('plan_disclaimer', e.target.value)} />

      <SectionLabel className="mt-6">Default quote terms</SectionLabel>
      <textarea className="input min-h-36 max-w-2xl" value={form.quote_terms ?? ''} onChange={(e) => set('quote_terms', e.target.value)} placeholder={'e.g. 50% deposit on acceptance, balance on completion.\nQuote valid for 30 days.'} />

      <SectionLabel className="mt-6">Bank details (shown on quotes)</SectionLabel>
      <textarea className="input min-h-36 max-w-2xl" value={form.bank_details ?? ''} onChange={(e) => set('bank_details', e.target.value)} placeholder={'Bank: FNB\nAccount name: …\nAccount no: …\nBranch code: 250655'} />

      <SaveRow onSave={onSave} disabled={!settings} saving={saving} saved={saved} />
    </Card>
  )
}

/** Raptor's small capital heading inside a tab ("PERSONAL INFORMATION"). */
function SectionLabel({ children, className = '' }: { children: string; className?: string }) {
  return <h4 className={`mb-3 text-xs font-semibold tracking-wide text-slate-400 uppercase ${className}`}>{children}</h4>
}

/** The Save at the foot of a tab, Raptor's place for it: under what it saves, not at the top of the page. */
function SaveRow({ onSave, saving, saved, disabled, label = 'Save changes' }: { onSave: () => void; saving: boolean; saved: boolean; disabled?: boolean; label?: string }) {
  return (
    <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4">
      <Button variant="primary" onClick={onSave} loading={saving} disabled={disabled}><Save size={15} /> {label}</Button>
      {saved && <span className="text-sm font-medium text-emerald-700">Saved</span>}
    </div>
  )
}
