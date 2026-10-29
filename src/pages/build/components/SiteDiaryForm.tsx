import { useEffect, useState } from 'react'
import { NumInput } from '../../../components/ui/NumInput'
import { addDiaryPhoto, siteDiary } from '../../../lib/api'
import { DictateButton } from '../../../components/ui/Dictate'
import { PhotoButtons, PhotoStrip, removeDiaryPhoto, useDiaryPhotos } from './DiaryPhotos'
import { todayYmd } from '../../../lib/format'
import { Button, Field, Modal } from '../../../components/ui'
import type { Project, SiteDiaryEntry } from '../../../types'
import { ProjectSelect } from './ProjectSelect'

export function SiteDiaryForm({ open, onClose, onSaved, editing, projectId, projects }: { open: boolean; onClose: () => void; onSaved: () => void; editing?: SiteDiaryEntry | null; projectId?: string; projects: Project[] }) {
  const [form, setForm] = useState<Partial<SiteDiaryEntry>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* Photos picked before the entry is saved wait here; an existing entry's photos are uploaded at once. */
  const [pending, setPending] = useState<{ key: string; file: File; url: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const existing = useDiaryPhotos(editing ? [editing.id] : [])
  useEffect(() => {
    if (open) {
      setForm(editing ?? { date: todayYmd(), project_id: projectId })
      setError(null)
      setPending([])
    }
  }, [open, editing, projectId])

  async function addPhotos(files: File[]) {
    if (!editing) {
      setPending((p) => [...p, ...files.map((file) => ({ key: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))])
      return
    }
    setUploading(true); setError(null)
    try { for (const f of files) await addDiaryPhoto(editing, f); existing.reload() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setUploading(false) }
  }
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
      else {
        const made = await siteDiary.create(values)
        for (const p of pending) await addDiaryPhoto(made, p.file)
      }
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
        <Field label="Workers on site"><NumInput allowEmpty inputMode="numeric" value={form.workers_on_site ?? null} onValue={(n) => set('workers_on_site', n === null ? null : Math.max(0, Math.round(n)))} /></Field>
        <Field label="Weather" className="sm:col-span-2"><input className="input" value={form.weather ?? ''} onChange={(e) => set('weather', e.target.value)} placeholder="Sunny, 28°C" /></Field>
        <Field label="Work done" className="sm:col-span-2">
          {/* Said, not typed, on site (the quote's microphone). */}
          <div className="mb-1 flex justify-end"><DictateButton size="small" value={form.work_done ?? ''} onChange={(v) => set('work_done', v)} /></div>
          <textarea className="input min-h-20" value={form.work_done ?? ''} onChange={(e) => set('work_done', e.target.value)} />
        </Field>
        <Field label="Photos" className="sm:col-span-2">
          <div className="space-y-2">
            <PhotoStrip
              photos={[...(editing ? existing.byEntry.get(editing.id) ?? [] : []).map((p) => ({ key: p.id, url: p.url })), ...pending.map((p) => ({ key: p.key, url: p.url }))]}
              onRemove={(key) => {
                const saved = editing ? (existing.byEntry.get(editing.id) ?? []).find((p) => p.id === key) : undefined
                if (saved) { if (window.confirm('Remove this photo?')) void removeDiaryPhoto(saved).then(existing.reload).catch((e: Error) => setError(e.message)) }
                else setPending((ps) => ps.filter((p) => p.key !== key))
              }}
            />
            <PhotoButtons onFiles={(f) => void addPhotos(f)} busy={uploading} />
            {uploading && <p className="text-xs text-slate-500">Sending the photos…</p>}
          </div>
        </Field>
        <Field label="Materials delivered" className="sm:col-span-2"><textarea className="input" value={form.materials_delivered ?? ''} onChange={(e) => set('materials_delivered', e.target.value)} /></Field>
        <Field label="Delays" className="sm:col-span-2"><textarea className="input" value={form.delays ?? ''} onChange={(e) => set('delays', e.target.value)} /></Field>
        <Field label="Safety notes" className="sm:col-span-2"><textarea className="input" value={form.safety_notes ?? ''} onChange={(e) => set('safety_notes', e.target.value)} /></Field>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
