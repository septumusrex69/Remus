import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { markAllNotificationsRead, markNotificationRead, useNotifications } from '../../lib/notifications'
import { groupNotifications, linkIsOpen, notificationWhen, type NotificationGroup } from '../../lib/notificationGroups'

/** Raptor's NotificationsMenu, reading Remus's own notifications (lib/notifications). */
export function NotificationsMenu() {
  const { notifications, refresh } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const groups = useMemo(() => groupNotifications(notifications), [notifications])
  /* The badge counts THINGS waiting, as the list shows them: two replies on R-6 are one. */
  const unread = groups.filter((g) => g.unread > 0).length

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  /* Opening the thing reads its notifications -- see linkIsOpen. The bell is in the top bar of
     every page, so this one watcher covers every link without any page knowing about it. */
  const marked = useRef(new Set<string>())
  useEffect(() => {
    for (const n of notifications) {
      /* Once per id: the effect runs again before the list has the change, and one write is enough. */
      if (!n.read && !marked.current.has(n.id) && linkIsOpen(n.link, location.pathname, location.search)) {
        marked.current.add(n.id)
        void markNotificationRead(n.id)
      }
    }
  }, [location.pathname, location.search, notifications])

  function handleSelect(g: NotificationGroup) {
    for (const id of g.ids) if (notifications.find((n) => n.id === id && !n.read)) void markNotificationRead(id)
    setOpen(false)
    if (g.latest.link) navigate(g.latest.link)
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
          {groups.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">No notifications yet.</p>
          ) : (
            groups.map((g) => (
              <button key={g.key} onClick={() => handleSelect(g)} className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-slate-50"
                data-testid="notification" data-unread={g.unread > 0 ? 'true' : 'false'}>
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${g.unread > 0 ? 'bg-brand-500' : 'bg-transparent'}`} />
                <div className="min-w-0">
                  <p className={`text-[13px] leading-snug ${g.unread > 0 ? 'font-medium text-slate-800' : 'text-slate-600'}`}>{g.latest.message}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {notificationWhen(g.latest.created_at, Date.now())}
                    {g.more > 0 && ` · and ${g.more} more`}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
