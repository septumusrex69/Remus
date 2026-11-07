import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, CheckSquare, HardHat, Mail, MessageCircle, Paperclip, Phone, StickyNote, Trash2, type LucideIcon } from 'lucide-react'
import { parseEmailActivity } from '../../../lib/emailActivity'
import { formatDate } from '../../../lib/format'
import { logActivity, removeActivity } from '../../../lib/tasksApi'
import { LOG_TYPES, type ActivityRow, type LogType } from '../../../lib/tasks'
import { useAuth } from '../../../store/AuthContext'
import { Button, ErrorBanner, Field, Modal } from '../../../components/ui'
import { ClientPicker } from '../components/ClientPicker'
import { Avatar } from '../tasks/TaskList'
import { paths } from '../paths'
import type { ClientDirectory } from '../../../lib/api'
import type { ClientRef, ID, Profile, Project } from '../../../types'

/* Raptor's activity icons (ACTIVITY_TYPE_TAILWIND), in skin tokens. */
export const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  Call: Phone, Email: Mail, WhatsApp: MessageCircle, Meeting: Calendar, Note: StickyNote, Task: CheckSquare, 'Site visit': HardHat,
}
const ICON_TONE: Record<string, string> = {
  Call: 'bg-brand-100 text-brand-800',
  Email: 'bg-slate-100 text-slate-700',
  WhatsApp: 'bg-emerald-50 text-emerald-700',
  Meeting: 'bg-ink-950 text-white',
  Note: 'bg-brand-50 text-brand-700',
  Task: 'bg-emerald-50 text-emerald-700',
  'Site visit': 'bg-slate-200 text-slate-800',
}

/**
 * THE TIMELINE (Raptor's ActivitiesPage list): grouped by day, a row an activity -- icon, what happened with the
 * notes after it in grey (whole in the tooltip), who and what it is about, the person, the time. "A day of thirty
 * calls is thirty lines."
 *
 * Emails are activities too (the mailbox files them on the client, migration 0010), so they sit in the same line
 * of time, marked Sent or Received, and open on the client's Emails tab.
 */
export function ActivityTimeline({ rows, team, dir, projects, canEdit, onChanged, showAbout = true, empty = 'Nothing logged yet.' }: {
  rows: ActivityRow[]
  team: Profile[]
  dir: ClientDirectory | null
  projects: Project[]
  canEdit: boolean
  onChanged: () => void
  /** Show which client / job each row is about (not on a record's own tab). */
  showAbout?: boolean
  empty?: string
}) {
  const { currentUser } = useAuth()
  const [error, setError] = useState<string | null>(null)
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-slate-400" data-testid="activity-empty">{empty}</p>

  const groups: { day: string; items: ActivityRow[] }[] = []
  for (const a of rows) {
    const day = formatDate(a.activity_date, 'EEEE d MMMM yyyy')
    const last = groups[groups.length - 1]
    if (last?.day === day) last.items.push(a)
    else groups.push({ day, items: [a] })
  }
  const person = (id: ID) => team.find((p) => p.id === id)
  const projectName = (id: ID | null) => (id ? projects.find((p) => p.id === id)?.name : null)

  return (
    <div className="space-y-4" data-testid="activity-timeline">
      <ErrorBanner error={error} />
      {groups.map((g) => (
        <div key={g.day}>
          <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">{g.day}</p>
          <ul className="card overflow-hidden">
            {g.items.map((a) => {
              const email = a.type === 'Email' ? parseEmailActivity(a.subject) : null
              const Icon = ACTIVITY_ICONS[a.type] ?? StickyNote
              const subject = email ? email.subject || '(no subject)' : a.subject
              const company = a.company_id ? dir?.companyById.get(a.company_id) : null
              const contact = a.contact_id ? dir?.contactById.get(a.contact_id) : null
              const clientTo = company ? paths.company(company.id) : contact ? paths.contact(contact.id) : null
              const clientName = company?.name ?? (contact ? `${contact.first_name} ${contact.last_name}`.trim() : null)
              const job = projectName(a.project_id)
              const own = canEdit && a.type !== 'Email' && a.type !== 'Task' && (a.user_id === currentUser?.id || currentUser?.role === 'Administrator')
              return (
                <li key={a.id} data-testid="activity-row" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-slate-50 px-3 py-1.5 text-[12.5px] last:border-0 hover:bg-slate-50 sm:flex-nowrap">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${ICON_TONE[a.type] ?? 'bg-slate-100 text-slate-600'}`} title={a.type}>
                    <Icon size={12} />
                  </span>
                  <span className="min-w-0 flex-1 basis-48 truncate" title={a.notes ? `${subject} · ${a.notes}` : subject}>
                    {email && <span className="mr-1 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{email.direction === 'sent' ? 'Sent' : 'Received'}</span>}
                    {email && clientTo
                      ? <Link to={`${clientTo}?tab=emails&email=${a.id}`} className="font-medium text-slate-700 hover:text-brand-700 hover:underline">{subject}</Link>
                      : <span className="font-medium text-slate-700">{subject}</span>}
                    {a.attachment_names?.length ? <Paperclip size={11} className="ml-1 inline text-slate-400" /> : null}
                    {a.notes && !email && <span className="text-slate-500"> · {a.notes}</span>}
                  </span>
                  {showAbout && (clientName || job) && (
                    <span className="max-w-[16rem] min-w-0 truncate text-slate-500">
                      {clientName && (clientTo ? <Link to={clientTo} className="text-brand-700 hover:underline">{clientName}</Link> : clientName)}
                      {clientName && job && <span className="text-slate-400"> · </span>}
                      {job && a.project_id && <Link to={paths.project(a.project_id, 'activity')} className="text-brand-700 hover:underline">{job}</Link>}
                    </span>
                  )}
                  <Avatar person={person(a.user_id)} size={16} />
                  <span className="w-12 shrink-0 text-right text-slate-400 tabular-nums">{formatDate(a.activity_date, 'HH:mm')}</span>
                  {own && (
                    <button
                      type="button"
                      title="Delete"
                      aria-label="Delete"
                      className="shrink-0 text-slate-300 hover:text-red-600"
                      onClick={async () => {
                        if (!window.confirm('Delete this from the log?')) return
                        try { await removeActivity(a.id); onChanged() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** What a new log entry starts with when it is made from a record. */
export interface LogDefaults { type?: LogType; project_id?: ID | null; company_id?: ID | null; contact_id?: ID | null }

const nowLocal = () => {
  const d = new Date()
  d.setSeconds(0, 0)
  return `${formatDate(d.toISOString(), "yyyy-MM-dd'T'HH:mm")}`
}

/**
 * "LOG A CALL / NOTE / MEETING" (Raptor's quick-add note and log-activity forms). What kind, what happened, when
 * (now, unless it was earlier), and what it is about: a job and/or a client.
 */
export function LogActivityModal({ open, defaults, dir, projects, onClose, onSaved }: {
  open: boolean
  defaults?: LogDefaults
  dir: ClientDirectory | null
  projects: Project[]
  onClose: () => void
  onSaved: () => void
}) {
  const { currentUser } = useAuth()
  const [type, setType] = useState<LogType>('Call')
  const [subject, setSubject] = useState('')
  const [notes, setNotes] = useState('')
  const [when, setWhen] = useState(nowLocal)
  const [project, setProject] = useState<ID | null>(null)
  const [client, setClient] = useState<ClientRef>({ company_id: null, contact_id: null })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setType(defaults?.type ?? 'Call')
    setSubject('')
    setNotes('')
    setWhen(nowLocal())
    setProject(defaults?.project_id ?? null)
    setClient({ company_id: defaults?.company_id ?? null, contact_id: defaults?.contact_id ?? null })
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const placeholder: Record<LogType, string> = {
    Call: 'Called about the tiles', Note: 'Client prefers mornings', Meeting: 'Walked the site with the client',
    'Site visit': 'Checked the slab', WhatsApp: 'Sent photos of the progress',
  }

  async function save() {
    if (!subject.trim()) return setError('Say in a few words what happened.')
    if (!currentUser) return
    setSaving(true)
    setError(null)
    try {
      await logActivity({
        type, subject: subject.trim(), notes: notes.trim() || null, activity_date: new Date(when).toISOString(),
        project_id: project, company_id: client.company_id, contact_id: client.contact_id,
      }, currentUser.id)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Log a ${type === 'Site visit' ? 'site visit' : type === 'WhatsApp' ? 'WhatsApp' : type.toLowerCase()}`}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={save} data-testid="activity-save">Save</Button>
      </>}
    >
      <div className="space-y-3" data-testid="activity-form">
        <ErrorBanner error={error} />
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What kind">
          {LOG_TYPES.map((t) => {
            const Icon = ACTIVITY_ICONS[t] ?? StickyNote
            return (
              <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${type === t ? 'bg-brand-500 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Icon size={13} /> {t}
              </button>
            )
          })}
        </div>
        <Field label="What happened">
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={placeholder[type]} autoFocus data-testid="activity-subject" />
        </Field>
        <Field label="Notes">
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="When">
          <input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Job">
          <select className="input" value={project ?? ''} onChange={(e) => {
            const id = e.target.value || null
            const p = projects.find((x) => x.id === id)
            if (p && !client.company_id && !client.contact_id) setClient({ company_id: p.company_id, contact_id: p.contact_id })
            setProject(id)
          }}>
            <option value="">Not about a job</option>
            {projects.filter((p) => p.status !== 'cancelled' || p.id === project).map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>)}
          </select>
        </Field>
        <div>
          <span className="label">Client</span>
          <ClientPicker dir={dir} value={client} onChange={setClient} />
        </div>
      </div>
    </Modal>
  )
}
