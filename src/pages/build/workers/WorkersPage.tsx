import { useEffect, useMemo, useState } from 'react'
import { seesMoney, useAccess } from '../../../lib/access'
import { useSearchParams } from 'react-router-dom'
import { Plus, Search, UserRound } from 'lucide-react'
import { workers as workersApi } from '../../../lib/api'
import { formatZAR } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { useBuild } from '../BuildContext'
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner } from '../../../components/ui'
import { NumInput } from '../../../components/ui/NumInput'
import type { LabourGrade, Worker } from '../../../types'

/**
 * The people on site (Stephan, 26 Oct 2026: "individual workers", priced "per worker per day,
 * junior or senior"). Not logins: most never sign in. Booked onto project stages in a project's
 * Plan & crew tab, and shown day by day on the Schedule.
 */
export function WorkersPage() {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Partial<Worker> | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const { data, error, loading, reload } = useLoad(() => workersApi.list(), [], 'workers')
  const money = seesMoney(useAccess())

  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (params.get('new') !== '1') return
    setEditing({ grade: 'senior', active: true })
    setParams((p) => { p.delete('new'); return p }, { replace: true })
  }, [params, setParams])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data ?? [])
      .filter((w) => showInactive || w.active)
      .filter((w) => !needle || [w.name, w.trade, w.phone].filter(Boolean).join(' ').toLowerCase().includes(needle))
  }, [data, q, showInactive])

  return (
    <div>
      <PageHeader
        title="Workers"
        subtitle="The people on site, what a day of each costs, and who is senior or junior."
        actions={<Button variant="primary" onClick={() => setEditing({ grade: 'senior', active: true })}><Plus size={16} /> New worker</Button>}
      />
      <ErrorBanner error={error} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative sm:w-72">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, trade, phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show people who have left
        </label>
      </div>
      <Card padded={false}>
        {loading && !data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No workers yet" icon={<UserRound size={32} />}>Add your team with their day cost; then book them onto project stages.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((w) => (
              <li key={w.id}>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" onClick={() => setEditing(w)}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${w.grade === 'senior' ? 'bg-brand-100 text-brand-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {w.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {w.name}{w.trade ? <span className="font-normal text-slate-500"> · {w.trade}</span> : null}
                      {!w.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">left</span>}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{w.grade === 'senior' ? 'Senior' : 'Junior'}{w.phone ? ` · ${w.phone}` : ''}</span>
                  </span>
                  {money && <span className="tabular shrink-0 text-sm text-slate-700">{formatZAR(Number(w.day_cost))} <span className="text-xs text-slate-400">a day</span></span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <WorkerModal initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

/** Add or edit a worker. A new one starts from the day rate for their grade in Settings. */
export function WorkerModal({ initial, onClose, onSaved }: { initial: Partial<Worker>; onClose: () => void; onSaved: (w: Worker) => void }) {
  const { settings } = useBuild()
  // A day's cost is money (lib/access.ts): a new worker added by someone else starts at the grade's rate.
  const money = seesMoney(useAccess())
  const rateFor = (g: LabourGrade) => Number((g === 'junior' ? settings?.labour_day_rate_junior : settings?.labour_day_rate_senior) ?? 0)
  const [form, setForm] = useState<Partial<Worker>>(() => (initial.id ? initial : { ...initial, day_cost: initial.day_cost ?? rateFor(initial.grade ?? 'senior') }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Worker>(k: K, v: Worker[K] | null) => setForm((f) => ({ ...f, [k]: v }))
  const text = (v: string | null | undefined) => (v ?? '').trim() || null

  async function save() {
    if (!form.name?.trim()) { setError('Give the worker a name.'); return }
    setSaving(true)
    setError(null)
    try {
      const values = {
        name: form.name.trim(),
        trade: text(form.trade),
        grade: form.grade ?? 'senior',
        day_cost: Math.max(0, Number(form.day_cost ?? 0)),
        phone: text(form.phone),
        notes: text(form.notes),
        active: form.active ?? true,
      }
      onSaved(form.id ? await workersApi.update(form.id, values) : await workersApi.create(values))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={form.id ? form.name || 'Worker' : 'New worker'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={saving}>Save</Button></>}>
      <ErrorBanner error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Trade"><input className="input" value={form.trade ?? ''} onChange={(e) => set('trade', e.target.value)} placeholder="e.g. Bricklayer" list="worker-trades" /></Field>
        <datalist id="worker-trades">
          {['General worker', 'Bricklayer', 'Plasterer', 'Tiler', 'Carpenter', 'Painter', 'Plumber', 'Electrician', 'Foreman'].map((t) => <option key={t} value={t} />)}
        </datalist>
        <Field label="Senior or junior">
          <select
            className="input"
            value={form.grade ?? 'senior'}
            onChange={(e) => {
              const g = e.target.value as LabourGrade
              // A new worker follows the grade's rate until someone types their own.
              setForm((f) => ({ ...f, grade: g, ...(!f.id && Number(f.day_cost ?? 0) === rateFor(f.grade ?? 'senior') ? { day_cost: rateFor(g) } : {}) }))
            }}
          >
            <option value="senior">Senior</option>
            <option value="junior">Junior</option>
          </select>
        </Field>
        {money && (
          <Field label="Cost per day" hint="What a day of this person costs you.">
            <NumInput prefix="R" value={form.day_cost ?? 0} onValue={(n) => set('day_cost', Math.max(0, n))} />
          </Field>
        )}
        <Field label="Phone"><input className="input" type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="input min-h-20" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        {form.id && (
          <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
            <input type="checkbox" checked={!(form.active ?? true)} onChange={(e) => set('active', !e.target.checked)} /> No longer works for us (hidden from booking)
          </label>
        )}
      </div>
    </Modal>
  )
}
