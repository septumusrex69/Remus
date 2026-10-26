import { useEffect, useMemo, useState } from 'react'
import { NumInput } from '../../../components/ui/NumInput'
import { useSearchParams } from 'react-router-dom'
import { HardHat, Plus, Search, Star } from 'lucide-react'
import { subcontractors as subsApi } from '../../../lib/api'
import { formatZAR } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner } from '../../../components/ui'
import { SUB_RATE_UNITS, type Subcontractor, type SubRateUnit } from '../../../types'

/**
 * The people and firms Urban Haus hires in (Stephan, 26 Oct 2026: "there should be a data thing for
 * all the subcontracts that we use"). Picked on a quote's subcontractor line, where their usual
 * rate fills in the cost. Internal: none of this reaches a client.
 */

export const RATE_UNIT_LABEL: Record<SubRateUnit, string> = { day: 'per day', job: 'per job', hour: 'per hour', 'm²': 'per m²', each: 'each' }

export function rateLabel(s: Pick<Subcontractor, 'rate_amount' | 'rate_unit'>): string {
  return s.rate_amount ? `${formatZAR(Number(s.rate_amount))} ${RATE_UNIT_LABEL[s.rate_unit]}` : ''
}

export function SubcontractorsPage() {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Partial<Subcontractor> | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const { data, error, loading, reload } = useLoad(() => subsApi.list(), [], 'subcontractors')

  // The top bar's "+ Add" can land here with ?new=1.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (params.get('new') !== '1') return
    setEditing({ rate_unit: 'job', active: true })
    setParams((p) => { p.delete('new'); return p }, { replace: true })
  }, [params, setParams])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data ?? [])
      .filter((s) => showInactive || s.active)
      .filter((s) => !needle || [s.name, s.trade, s.contact_person, s.phone, s.email].filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [data, q, showInactive])

  return (
    <div>
      <PageHeader
        title="Subcontractors"
        subtitle="The people and firms you hire in. Internal: clients never see who does the work or what they charge."
        actions={<Button variant="primary" onClick={() => setEditing({ rate_unit: 'job', active: true })}><Plus size={16} /> New subcontractor</Button>}
      />
      <ErrorBanner error={error} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative sm:w-72">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, trade, phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show ones we no longer use
        </label>
      </div>
      <Card padded={false}>
        {loading && !data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No subcontractors yet" icon={<HardHat size={32} />}>Add the plumbers, electricians and others you use, with their usual rate.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((s) => (
              <li key={s.id}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" onClick={() => setEditing(s)}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700"><HardHat size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {s.name}{s.trade ? <span className="font-normal text-slate-500"> · {s.trade}</span> : null}
                      {!s.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">not used</span>}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{[s.contact_person, s.phone, s.email].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="hidden text-right sm:block">
                    <span className="tabular block text-sm text-slate-700">{rateLabel(s)}</span>
                    {s.rating ? <Stars value={s.rating} /> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <SubcontractorModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5 text-amber-500" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={11} fill={n <= value ? 'currentColor' : 'none'} />)}
    </span>
  )
}

/** Add or edit one. Also used from a quote line ("New subcontractor…"). */
export function SubcontractorModal({ initial, onClose, onSaved }: { initial: Partial<Subcontractor>; onClose: () => void; onSaved: (s: Subcontractor) => void }) {
  const [form, setForm] = useState<Partial<Subcontractor>>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Subcontractor>(k: K, v: Subcontractor[K] | null) => setForm((f) => ({ ...f, [k]: v }))
  const text = (v: string) => v.trim() || null

  async function save() {
    if (!form.name?.trim()) { setError('Give the subcontractor a name.'); return }
    setSaving(true)
    setError(null)
    try {
      const values = {
        name: form.name.trim(),
        trade: text(form.trade ?? ''),
        contact_person: text(form.contact_person ?? ''),
        phone: text(form.phone ?? ''),
        email: text(form.email ?? ''),
        rate_amount: form.rate_amount === null || form.rate_amount === undefined || String(form.rate_amount) === '' ? null : Number(form.rate_amount),
        rate_unit: form.rate_unit ?? 'job',
        vat_no: text(form.vat_no ?? ''),
        bank_details: text(form.bank_details ?? ''),
        notes: text(form.notes ?? ''),
        rating: form.rating ?? null,
        active: form.active ?? true,
      }
      const saved = form.id ? await subsApi.update(form.id, values) : await subsApi.create(values)
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={form.id ? form.name || 'Subcontractor' : 'New subcontractor'}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>Save</Button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Peter's Plumbing" autoFocus /></Field>
        <Field label="Trade"><input className="input" value={form.trade ?? ''} onChange={(e) => set('trade', e.target.value)} placeholder="e.g. Plumber" list="sub-trades" /></Field>
        <datalist id="sub-trades">
          {['Plumber', 'Electrician', 'Tiler', 'Painter', 'Carpenter', 'Roofer', 'Plasterer', 'Glazier', 'Welder', 'Landscaper'].map((t) => <option key={t} value={t} />)}
        </datalist>
        <Field label="Contact person"><input className="input" value={form.contact_person ?? ''} onChange={(e) => set('contact_person', e.target.value)} /></Field>
        <Field label="Phone"><input className="input" type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Usual rate (R)" hint="Fills in the cost when you pick them on a quote.">
          <div className="flex gap-2">
            <NumInput allowEmpty prefix="R" value={form.rate_amount ?? null} onValue={(n) => set('rate_amount', n === null ? null : Math.max(0, n))} />
            <select className="input w-auto" value={form.rate_unit ?? 'job'} onChange={(e) => set('rate_unit', e.target.value as SubRateUnit)} aria-label="Rate per">
              {SUB_RATE_UNITS.map((u) => <option key={u} value={u}>{RATE_UNIT_LABEL[u]}</option>)}
            </select>
          </div>
        </Field>
        <Field label="VAT no."><input className="input" value={form.vat_no ?? ''} onChange={(e) => set('vat_no', e.target.value)} /></Field>
        <Field label="How good are they?">
          <div className="flex items-center gap-1 py-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className="text-amber-500" onClick={() => set('rating', form.rating === n ? null : n)} aria-label={`${n} star${n === 1 ? '' : 's'}`}>
                <Star size={20} fill={(form.rating ?? 0) >= n ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Bank details" className="sm:col-span-2">
          <textarea className="input min-h-20" value={form.bank_details ?? ''} onChange={(e) => set('bank_details', e.target.value)} placeholder={'Bank: …\nAccount no: …\nBranch code: …'} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <textarea className="input min-h-20" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Areas they work in, reliability, anything worth remembering" />
        </Field>
        {form.id && (
          <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
            <input type="checkbox" checked={!(form.active ?? true)} onChange={(e) => set('active', !e.target.checked)} /> We no longer use them (hidden from lists and quotes)
          </label>
        )}
      </div>
    </Modal>
  )
}
