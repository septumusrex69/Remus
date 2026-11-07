import { Link } from 'react-router-dom'
import { clsx } from 'clsx'
import { Badge } from '../../../components/ui'
import { formatDate } from '../../../lib/format'
import { isOpen, localDay, taskTime, type Task } from '../../../lib/tasks'
import { paths } from '../paths'
import type { ID, Profile } from '../../../types'

/* Raptor's PriorityBadge and TaskStatusBadge, in skin tokens (never a fixed colour). */
const PRIORITY_TONE: Record<string, string> = {
  Low: 'bg-slate-100 text-slate-500',
  Medium: 'bg-slate-100 text-slate-700',
  High: 'bg-brand-100 text-brand-800',
  Urgent: 'bg-red-50 text-red-700',
}
const STATUS_TONE: Record<string, string> = {
  'Not Started': 'bg-slate-100 text-slate-600',
  'In Progress': 'bg-brand-50 text-brand-800',
  Completed: 'bg-emerald-50 text-emerald-700',
  Cancelled: 'bg-slate-100 text-slate-400',
}
export const PriorityBadge = ({ priority }: { priority: string }) => <Badge tone={PRIORITY_TONE[priority]}>{priority}</Badge>
export const TaskStatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status]}>{status}</Badge>

/** A person's initials in a small circle (Raptor's UserAvatar), in their own avatar colour from Settings. */
export function Avatar({ person, size = 20 }: { person?: Pick<Profile, 'name' | 'email' | 'avatar_color'> | null; size?: number }) {
  const name = person?.name || person?.email || '?'
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-ink-950 font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), backgroundColor: person?.avatar_color || undefined }}
    >
      {initials}
    </span>
  )
}

/**
 * THE LIST, ONE LINE A TASK at 12.5px -- Raptor's "checking list's density, which the firm asked for on every list".
 * A tick box, the title (struck through when done), what kind and what it is about in grey, priority, status, when,
 * whose, then Edit / Reschedule / Cancel. On a phone the line wraps rather than scrolling the page sideways.
 */
export function TaskList({ tasks, team, today, dayShown, canEdit, onToggle, onEdit, onReschedule, onCancel, empty = 'No tasks in this view.', showLinks = true }: {
  tasks: Task[]
  team: Profile[]
  today: string
  /** On a one-day list the time is shown instead of the date ("Any time" where none was set). */
  dayShown?: string | null
  canEdit: boolean
  onToggle: (t: Task, done: boolean) => void
  onEdit: (t: Task) => void
  onReschedule: (t: Task) => void
  onCancel: (t: Task) => void
  empty?: string
  /** Link the job and the client (not on the job's own page). */
  showLinks?: boolean
}) {
  const person = (id: ID) => team.find((p) => p.id === id)
  if (tasks.length === 0) return <p className="py-10 text-center text-sm text-slate-400">{empty}</p>
  return (
    <ul data-testid="task-list">
      {tasks.map((t) => {
        const overdue = isOpen(t) && localDay(new Date(t.due_date)) < today
        const done = t.status === 'Completed'
        const about = t.project_id && showLinks ? paths.project(t.project_id, 'tasks')
          : t.company_id && showLinks ? `${paths.company(t.company_id)}?tab=tasks`
            : t.contact_id && showLinks ? `${paths.contact(t.contact_id)}?tab=tasks` : null
        return (
          <li key={t.id} data-testid="task-row" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-50 px-3 py-1.5 text-[12.5px] last:border-0 hover:bg-slate-50 sm:flex-nowrap">
            <input
              type="checkbox"
              checked={done}
              disabled={!canEdit || t.status === 'Cancelled'}
              onChange={(e) => onToggle(t, e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-brand-600"
              aria-label={done ? `Not done: ${t.title}` : `Done: ${t.title}`}
              data-testid="task-tick"
            />
            <div className="flex min-w-0 flex-1 basis-40 items-center gap-1.5">
              <span className={clsx('min-w-0 truncate font-medium', done || t.status === 'Cancelled' ? 'text-slate-400 line-through' : 'text-slate-700')} title={t.notes ? `${t.title} — ${t.notes}` : t.title}>
                {t.title}
              </span>
              <span className="min-w-0 truncate text-slate-400" title={t.related_to_label ?? undefined}>
                · {t.type}
                {t.related_to_label && (about ? <> · <Link to={about} className="hover:text-brand-700 hover:underline">{t.related_to_label}</Link></> : ` · ${t.related_to_label}`)}
              </span>
            </div>
            <PriorityBadge priority={t.priority} />
            <TaskStatusBadge status={t.status} />
            <span className={clsx('w-20 shrink-0 text-right font-medium tabular-nums', overdue ? 'text-red-700' : 'text-slate-500')} title={t.cancel_reason ? `Cancelled: ${t.cancel_reason}` : undefined}>
              {dayShown ? (taskTime(t) ?? <span className="text-slate-300">Any time</span>) : formatDate(t.due_date, 'd MMM')}
            </span>
            <Avatar person={person(t.owner_id)} size={18} />
            {canEdit && (
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => onEdit(t)} className="text-xs font-medium text-brand-700 hover:underline">Edit</button>
                <button type="button" onClick={() => onReschedule(t)} className="text-xs font-medium text-brand-700 hover:underline">Reschedule</button>
                {isOpen(t) && <button type="button" onClick={() => onCancel(t)} className="text-xs font-medium text-slate-400 hover:text-red-700">Cancel</button>}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
