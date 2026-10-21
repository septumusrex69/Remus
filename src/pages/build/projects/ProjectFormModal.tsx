import { useEffect, useState } from 'react'
import { loadClientDirectory, projects as projectsApi, type ClientDirectory } from '../../../lib/api'
import { labelize } from '../../../lib/format'
import { Button, Field, Modal } from '../../../components/ui'
import { PROJECT_STATUSES, type Project, type ProjectStatus } from '../../../types'
import { ClientPicker } from '../components/ClientPicker'

export function ProjectFormModal({ open, onClose, onSaved, editing }: { open: boolean; onClose: () => void; onSaved: (p: Project) => void; editing?: Project | null }) {
  const [form, setForm] = useState<Partial<Project>>({})
  const [dir, setDir] = useState<ClientDirectory | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(editing ?? { status: 'planned', contract_value: 0, budget: 0, company_id: null, contact_id: null })
    setError(null)
    loadClientDirectory().then(setDir).catch(() => {})
  }, [open, editing])

  const set = <K extends keyof Project>(k: K, v: Project[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!form.name?.trim()) return setError('Name is required')
    setSaving(true)
    setError(null)
    try {
      const values = {
        name: form.name.trim(),
        code: form.code?.trim() || null,
        company_id: form.company_id ?? null,
        contact_id: form.contact_id ?? null,
        site_address: form.site_address || null,
        status: form.status ?? 'planned',
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        contract_value: Number(form.contract_value || 0),
        budget: Number(form.budget || 0),
        notes: form.notes || null,
      }
      onSaved(editing ? await projectsApi.update(editing.id, values) : await projectsApi.create(values))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(/duplicate key|unique/i.test(msg) && /code/i.test(msg) ? 'That project code is already used.' : msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit project' : 'New project'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={save} loading={saving}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Code"><input className="input" value={form.code ?? ''} onChange={(e) => set('code', e.target.value)} placeholder="P-0001" /></Field>
        <Field label="Status">
          <select className="input" value={form.status ?? 'planned'} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </select>
        </Field>
        <Field label="Client" className="sm:col-span-2">
          <ClientPicker dir={dir} value={{ company_id: form.company_id ?? null, contact_id: form.contact_id ?? null }} onChange={(v) => setForm((f) => ({ ...f, ...v }))} onCreated={() => loadClientDirectory().then(setDir)} />
        </Field>
        <Field label="Site address" className="sm:col-span-2"><input className="input" value={form.site_address ?? ''} onChange={(e) => set('site_address', e.target.value)} /></Field>
        <Field label="Start date"><input type="date" className="input" value={form.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} /></Field>
        <Field label="End date"><input type="date" className="input" value={form.end_date ?? ''} onChange={(e) => set('end_date', e.target.value)} /></Field>
        <Field label="Contract value (excl. VAT)"><input type="number" step="0.01" className="input" value={form.contract_value ?? 0} onChange={(e) => set('contract_value', Number(e.target.value))} /></Field>
        <Field label="Budget (cost)"><input type="number" step="0.01" className="input" value={form.budget ?? 0} onChange={(e) => set('budget', Number(e.target.value))} /></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="input" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
