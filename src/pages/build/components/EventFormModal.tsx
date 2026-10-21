import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { diaryEvents } from '../../../lib/api'
import { labelize } from '../../../lib/format'
import { Button, Field, Modal } from '../../../components/ui'
import { EVENT_TYPES, type DiaryEvent, type EventType, type Profile, type Project } from '../../../types'
import { ProjectSelect } from './ProjectSelect'

const toLocalInput = (iso: string) => format(parseISO(iso), "yyyy-MM-dd'T'HH:mm")

export function EventFormModal({
  open,
  onClose,
  onSaved,
  editing,
  projects,
  team,
  defaults,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editing?: DiaryEvent | null
  projects: Project[]
  team: Profile[]
  defaults?: Partial<DiaryEvent>
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<EventType>('site_visit')
  const [allDay, setAllDay] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [location, setLocation] = useState('')
  const [owner, setOwner] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults

  useEffect(() => {
    if (!open) return
    const e = editing ?? (defaultsRef.current as DiaryEvent | undefined)
    const s = e?.start_at ?? new Date(new Date().setMinutes(0, 0, 0) + 3_600_000).toISOString()
    setTitle(e?.title ?? '')
    setType(e?.type ?? 'site_visit')
    setAllDay(e?.all_day ?? false)
    setStart(toLocalInput(s))
    setEnd(e?.end_at ? toLocalInput(e.end_at) : toLocalInput(new Date(parseISO(s).getTime() + 3_600_000).toISOString()))
    setProjectId(e?.project_id ?? null)
    setLocation(e?.location ?? '')
    setOwner(e?.owner_id ?? '')
    setNotes(e?.notes ?? '')
    setError(null)
  }, [open, editing])

  // Picking a project fills in its site as the location.
  function pickProject(id: string | null) {
    setProjectId(id)
    const p = projects.find((x) => x.id === id)
    if (p?.site_address && !location) setLocation(p.site_address)
  }

  async function save() {
    if (!title.trim()) return setError('Title is required')
    const startDay = start.slice(0, 10)
    const endDay = end.slice(0, 10)
    const startDate = allDay ? new Date(`${startDay}T00:00`) : new Date(start)
    const endDate = endDay ? (allDay ? new Date(`${endDay}T23:59`) : new Date(end)) : null
    if (!startDay || Number.isNaN(startDate.getTime())) return setError('Enter when the event starts.')
    if (endDate && Number.isNaN(endDate.getTime())) return setError('The end date/time is not valid — fix it or clear it.')
    if (endDate && endDate < startDate) return setError('The event ends before it starts.')
    setSaving(true)
    setError(null)
    try {
      const values = {
        title: title.trim(),
        type,
        all_day: allDay,
        start_at: startDate.toISOString(),
        end_at: endDate ? endDate.toISOString() : null,
        project_id: projectId,
        location: location || null,
        owner_id: owner || null,
        notes: notes || null,
      }
      if (editing) await diaryEvents.update(editing.id, values)
      else await diaryEvents.create(values)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editing || !window.confirm('Delete this event?')) return
    setError(null)
    try {
      await diaryEvents.remove(editing.id)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit event' : 'New event'}
      footer={
        <>
          {editing && <Button variant="danger" onClick={remove} className="mr-auto">Delete</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="dark" onClick={save} loading={saving}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as EventType)}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{labelize(t)}</option>)}
          </select>
        </Field>
        <Field label="Assigned to">
          <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">— Nobody —</option>
            {team.map((p) => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
        <Field label="Starts"><input type={allDay ? 'date' : 'datetime-local'} className="input" value={allDay ? start.slice(0, 10) : start} onChange={(e) => setStart(allDay ? `${e.target.value}T00:00` : e.target.value)} /></Field>
        <Field label="Ends"><input type={allDay ? 'date' : 'datetime-local'} className="input" value={allDay ? end.slice(0, 10) : end} onChange={(e) => setEnd(allDay ? `${e.target.value}T23:59` : e.target.value)} /></Field>
        <Field label="Project" className="sm:col-span-2"><ProjectSelect projects={projects} value={projectId} onChange={pickProject} /></Field>
        <Field label="Location" className="sm:col-span-2"><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
