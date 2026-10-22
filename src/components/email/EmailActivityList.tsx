import { useState } from 'react'
import { clsx } from 'clsx'
import { ArrowDownLeft, ArrowUpRight, Mail, Paperclip, Reply } from 'lucide-react'
import { downloadEmailAttachment, setEmailRead } from '../../lib/api'
import { emailDayLabel, emailTimeLabel, parseEmailActivity } from '../../lib/emailActivity'
import type { Activity, Profile } from '../../types'

type Direction = 'sent' | 'received'

/** What each colour means, in one place, so the badge, tooltip and legend can't disagree. */
const EMAIL_KINDS: Record<Direction, { label: string; badge: string; dot: string; hint: string }> = {
  sent: { label: 'Sent', badge: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500', hint: 'Sent from Remus by one of your team' },
  received: { label: 'Received', badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', hint: "Arrived in your team's inbox from this client" },
}

function directionOf(a: Activity): Direction {
  return parseEmailActivity(a.subject)?.direction === 'sent' ? 'sent' : 'received'
}

function DirectionBadge({ kind }: { kind: Direction }) {
  const { badge, label, hint } = EMAIL_KINDS[kind]
  const Icon = kind === 'sent' ? ArrowUpRight : ArrowDownLeft
  return (
    <span title={`${label} — ${hint}`} className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', badge)}>
      <Icon size={14} strokeWidth={2.4} />
    </span>
  )
}

/**
 * One email, collapsed to a single line until it's opened: badge, subject, a line of preview
 * and a time. The full body, attachments and Reply belong to the message you've chosen.
 * Ported from Raptor's EmailActivityRow.
 */
function EmailActivityRow({
  activity,
  open,
  onToggleOpen,
  onReply,
  onChanged,
  userName,
}: {
  activity: Activity
  open: boolean
  onToggleOpen: (next: boolean) => void
  onReply?: () => void
  onChanged: (patch: Partial<Activity>) => void
  userName?: string
}) {
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const parsed = parseEmailActivity(activity.subject)
  const kind = directionOf(activity)
  const subject = parsed?.subject ?? activity.subject
  const body = activity.notes ?? ''
  const attachments = activity.attachment_names ?? []
  const isIncoming = kind === 'received'
  const isUnread = isIncoming && activity.is_read === false

  function markRead(isRead: boolean) {
    onChanged({ is_read: isRead })
    void setEmailRead(activity.id, isRead).catch(() => onChanged({ is_read: !isRead }))
  }

  function toggle() {
    if (isUnread) markRead(true)
    onToggleOpen(!open)
  }

  async function download(name: string) {
    setDownloading(name)
    setDownloadError(null)
    try {
      await downloadEmailAttachment(activity.id, name)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Could not download that attachment.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className={open ? 'bg-slate-50/80' : ''}>
      <button onClick={toggle} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50" aria-expanded={open}>
        <DirectionBadge kind={kind} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className={clsx('max-w-[60%] shrink-0 truncate text-sm', isUnread ? 'font-semibold text-slate-900' : 'text-slate-700')}>{subject}</span>
          {!open && body && <span className="min-w-0 truncate text-sm text-slate-400">{body}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2.5">
          {attachments.length > 0 && <Paperclip size={13} className="text-slate-400" />}
          {isUnread && <span className="h-2 w-2 rounded-full bg-amber-500" title="Unread" />}
          <span className="tabular text-xs text-slate-400">{emailTimeLabel(activity.activity_date)}</span>
        </span>
      </button>

      {open && (
        <div className="pb-3.5 pl-[50px] pr-4">
          <p className="mb-2 text-xs text-slate-400">
            <span className={clsx('font-medium', kind === 'sent' ? 'text-sky-700' : 'text-emerald-700')}>{EMAIL_KINDS[kind].label}</span>
            {userName && ` · ${kind === 'sent' ? 'sent by' : 'received by'} ${userName}`}
            {` · ${emailDayLabel(activity.activity_date)} at ${emailTimeLabel(activity.activity_date)}`}
            {parsed?.isSpam && ' · was in Spam/Junk'}
          </p>
          {body && <p className="max-w-[70ch] whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">{body}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {attachments.map((name, i) => (
              <button
                key={`${name}-${i}`}
                onClick={() => void download(name)}
                disabled={downloading === name}
                title="Download from the mailbox"
                className="inline-flex max-w-[280px] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:border-amber-300 hover:text-amber-800 disabled:opacity-50"
              >
                <Paperclip size={12} className="shrink-0" />
                <span className="truncate">{name}</span>
                {downloading === name && <span className="text-slate-400">…</span>}
              </button>
            ))}
            {onReply && (
              <button onClick={onReply} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <Reply size={12} /> Reply
              </button>
            )}
            {isIncoming && !isUnread && (
              <button
                onClick={() => {
                  markRead(false)
                  onToggleOpen(false)
                }}
                title="Put this back on the unread list to follow up later"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
              >
                <Mail size={12} /> Mark unread
              </button>
            )}
          </div>
          {downloadError && <p className="mt-2 text-xs text-red-600">{downloadError}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * A client's emails, newest first, grouped under day headings. One message open at a time:
 * opening the next closes the last, so reading five emails doesn't leave a page metres long.
 */
export function EmailActivityList({
  activities,
  profiles,
  onReply,
  onChanged,
}: {
  activities: Activity[]
  profiles?: Profile[]
  onReply?: (activity: Activity) => void
  onChanged: (id: string, patch: Partial<Activity>) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.name || undefined

  const days = activities.map((a) => emailDayLabel(a.activity_date))
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-slate-100 px-4 py-2">
        {(Object.keys(EMAIL_KINDS) as Direction[]).map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1.5" title={EMAIL_KINDS[kind].hint}>
            <span className={clsx('h-2.5 w-2.5 rounded-sm', EMAIL_KINDS[kind].dot)} />
            <span className="text-[11px] text-slate-500">{EMAIL_KINDS[kind].label}</span>
          </span>
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {activities.map((a, i) => {
          const day = days[i]
          const showDay = i === 0 || day !== days[i - 1]
          return (
            <div key={a.id}>
              {showDay && <p className="border-b border-slate-100 bg-slate-50/80 px-4 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{day}</p>}
              <EmailActivityRow
                activity={a}
                open={openId === a.id}
                onToggleOpen={(next) => setOpenId(next ? a.id : null)}
                onReply={onReply ? () => onReply(a) : undefined}
                onChanged={(patch) => onChanged(a.id, patch)}
                userName={nameOf(a.user_id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
