import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { markAllNotificationsRead, markNotificationRead, timeAgo, useNotifications, type AppNotification } from '../../lib/notifications'

/** Raptor's NotificationsMenu, reading Remus's own notifications (lib/notifications). */
export function NotificationsMenu() {
  const { notifications, unread, refresh } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function handleSelect(n: AppNotification) {
    if (!n.read) void markNotificationRead(n.id)
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { if (!open) void refresh(); setOpen((o) => !o) }}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
        title="Notifications"
        data-testid="notifications-open"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 max-h-96 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-100 bg-white py-2 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-700">Notifications</h3>
            {unread > 0 && (
              <button onClick={() => void markAllNotificationsRead()} className="text-xs font-medium text-brand-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No notifications yet.</p>
          ) : (
            notifications.map((n) => (
              <button key={n.id} onClick={() => handleSelect(n)} className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-slate-50">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-brand-500'}`} />
                <div className="min-w-0">
                  <p className={`text-[13px] leading-snug ${n.read ? 'text-slate-600' : 'font-medium text-slate-800'}`}>{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{timeAgo(n.created_at)}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
