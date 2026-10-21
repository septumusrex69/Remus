import { useEffect, useState } from 'react'
import { siteDiary } from '../../../lib/api'
import { todayYmd } from '../../../lib/format'
import { Button, Field, Modal } from '../../../components/ui'
import type { Project, SiteDiaryEntry } from '../../../types'
import { ProjectSelect } from './ProjectSelect'

export function SiteDiaryForm({ open, onClose, onSaved, editing, projectId, projects }: { open: boolean; onClose: () => void; onSaved: () => void; editing?: SiteDiaryEntry | null; projectId?: string; projects: Project[] }) {
  const [form, setForm] = useState<Partial<SiteDiaryEntry>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setForm(editing ?? { date: todayYmd(), project_id: projectId })
      setError(null)
    }
  }, [open, editing, projectId])
  const set = <K extends keyof SiteDiaryEntry>(k: K, v: SiteDiaryEntry[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!form.project_id) return setError('Pick a project')
    setSaving(true)
    setError(null)
    try {
      const values = {
        project_id: form.project_id,
        date: form.date || todayYmd(),
        weather: form.weather || null,
        workers_on_site: form.workers_on_site ?? null,
        work_done: form.work_done || null,
        materials_delivered: form.materials_delivered || null,
        delays: form.delays || null,
        safety_notes: form.safety_notes || null,
      }
      if (editing) await siteDiary.update(editing.id, values)
      else await siteDiary.create(values)
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(/duplicate|unique/i.test(msg) ? 'There is already an entry for this project on that day — edit that one instead.' : msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit site diary' : 'Site diary entry'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={save} loading={saving}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {!projectId && <Field label="Project" className="sm:col-span-2"><ProjectSelect projects={projects} value={form.project_id ?? null} onChange={(v) => set('project_id', v ?? '')} allowOverhead={false} /></Field>}
        <Field label="Date"><input type="date" className="input" value={form.date ?? ''} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Workers on site"><input type="number" inputMode="numeric" min={0} className="input" value={form.workers_on_site ?? ''} onChange={(e) => set('workers_on_site', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        <Field label="Weather" className="sm:col-span-2"><input className="input" value={form.weather ?? ''} onChange={(e) => set('weather', e.target.value)} placeholder="Sunny, 28°C" /></Field>
        <Field label="Work done" className="sm:col-span-2"><textarea className="input min-h-20" value={form.work_done ?? ''} onChange={(e) => set('work_done', e.target.value)} /></Field>
        <Field label="Materials delivered" className="sm:col-span-2"><textarea className="input" value={form.materials_delivered ?? ''} onChange={(e) => set('materials_delivered', e.target.value)} /></Field>
        <Field label="Delays" className="sm:col-span-2"><textarea className="input" value={form.delays ?? ''} onChange={(e) => set('delays', e.target.value)} /></Field>
        <Field label="Safety notes" className="sm:col-span-2"><textarea className="input" value={form.safety_notes ?? ''} onChange={(e) => set('safety_notes', e.target.value)} /></Field>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
