import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Mail, MailOpen } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { clientLabel, loadClientDirectory, type ClientDirectory } from '../../lib/api'
import { useUnreadMail } from '../../lib/unreadMail'
import { paths } from '../../pages/build/paths'

/**
 * Unread mail, counted where people look for a count (Raptor's MessagesMenu). Separate from any
 * notification: an unread email is a person waiting on a reply. Each one opens on the Mail page,
 * with the client it is filed on named underneath.
 */
export function MessagesMenu() {
  const unread = useUnreadMail()
  const [open, setOpen] = useState(false)
  const [dir, setDir] = useState<ClientDirectory | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Opening the envelope is the moment someone asks "has anyone written to me", so read the mailbox then.
  useEffect(() => {
    if (!open) return
    void unread.sync()
    if (!dir) void loadClientDirectory().then(setDir).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const rows = useMemo(
    () =>
      unread.items.slice(0, 30).map((m) => ({
        a: m,
        subject: m.subject || '(no subject)',
        from: m.fromName || m.fromAddress,
        about: dir && (m.linkedCompanyId || m.linkedContactId) ? clientLabel(dir, { company_id: m.linkedCompanyId, contact_id: m.linkedContactId }) : null,
        preview: (m.snippet ?? '').replace(/\s+/g, ' ').trim(),
      })),
    [unread.items, dir],
  )

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        aria-label={unread.count > 0 ? `${unread.count} unread emails` : 'Mail'}
        title="Unread mail"
      >
        <Mail size={19} />
        {unread.count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white">
            {unread.count > 99 ? '99+' : unread.count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-16 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-100 bg-white py-2 shadow-lg sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[22rem]">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              Unread mail{unread.count > 0 && <span className="font-normal text-slate-400">· {unread.count}</span>}
              {unread.syncing && <Loader2 size={12} className="animate-spin text-slate-300" />}
            </h3>
            {unread.count > 0 && (
              <button onClick={() => void unread.markAllRead()} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="flex flex-col items-center gap-2 px-4 py-6 text-center text-sm text-slate-400">
              <MailOpen size={20} className="text-slate-300" />
              {unread.syncing ? 'Checking your mailbox…' : 'Nothing unread. Every message has been opened.'}
            </p>
          ) : (
            rows.map(({ a, subject, from, about, preview }) => (
              <button
                key={a.id}
                onClick={() => {
                  setOpen(false)
                  navigate(`${paths.mail()}?message=${encodeURIComponent(a.id)}`)
                }}
                className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-slate-50"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-snug font-medium text-slate-800">{from}</span>
                  <span className="block truncate text-[12.5px] leading-snug text-slate-700">{subject}</span>
                  {about && <span className="block truncate text-[12px] leading-snug text-brand-600">{about}</span>}
                  {preview && <span className="block truncate text-[12px] leading-snug text-slate-400">{preview}</span>}
                  <span className="mt-0.5 block text-[11px] text-slate-400">{formatDistanceToNowStrict(new Date(a.occurredAt), { addSuffix: true })}</span>
                </span>
              </button>
            ))
          )}
          <div className="border-t border-slate-100 px-4 pt-2">
            <button
              onClick={() => { setOpen(false); navigate(paths.mail()) }}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              Open Mail →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
