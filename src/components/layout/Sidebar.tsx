import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  Banknote, CalendarDays, CalendarRange, Camera, ChevronDown, FileText, FolderKanban, HardHat, Inbox, LayoutDashboard, LineChart, LogOut,
  Lightbulb, PanelLeftClose, PanelLeftOpen, Receipt, Settings, Users, UsersRound, type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { useBuild } from '../../pages/build/BuildContext'
import { paths } from '../../pages/build/paths'
import { useSidebarCollapsed } from '../../lib/sidebarCollapsed'
import { useUnreadMail } from '../../lib/unreadMail'
import { useTheme } from '../../store/ThemeContext'

/**
 * The navigation, copied from Raptor's Sidebar: folds to an icon rail (remembered per device),
 * labels become tooltips when folded, and a count becomes a dot.
 *
 * Only two items carry a count, Raptor's rule: a badge earns its place if it counts something one
 * person can clear today (unread client mail, bank lines to link).
 */
type Badge = 'mail' | 'bank'
const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: Badge }[] = [
  { to: paths.dashboard(), label: 'Dashboard', icon: LayoutDashboard, end: true },
  // Second, under Dashboard, as in Raptor: client mail is the first thing to check.
  { to: paths.mail(), label: 'Mail', icon: Inbox, badge: 'mail' },
  { to: paths.quotes(), label: 'Quotes', icon: FileText },
  { to: paths.projects(), label: 'Projects', icon: FolderKanban },
  { to: paths.clients(), label: 'Clients', icon: Users },
  { to: paths.schedule(), label: 'Schedule', icon: CalendarRange },
  { to: paths.workers(), label: 'Workers', icon: UsersRound },
  { to: paths.subcontractors(), label: 'Subcontractors', icon: HardHat },
  { to: paths.expenses(), label: 'Expenses', icon: Receipt },
  { to: paths.bank(), label: 'Bank', icon: Banknote, badge: 'bank' },
  { to: paths.diary(), label: 'Diary', icon: CalendarDays },
  { to: paths.finance(), label: 'Finance', icon: LineChart },
  // Everybody's, at Raptor's firm's word: "anyone can see requests".
  { to: paths.requests(), label: 'Requests', icon: Lightbulb },
  { to: paths.settings(), label: 'Settings', icon: Settings },
]

const ROLE_LABEL: Record<string, string> = { 'Read Only': 'Read only', Administrator: 'Administrator' }

/**
 * `drawer` is the phone version: always full width (a folded rail inside a slide-out drawer is
 * pointless), and every tap closes the drawer.
 */
export function Sidebar({ drawer, onNavigate }: { drawer?: boolean; onNavigate?: () => void }) {
  const { currentUser, signOut } = useAuth()
  const { needsLinking, settings } = useBuild()
  const { theme } = useTheme()
  const unreadMail = useUnreadMail()
  const [foldedPref, toggleCollapsed] = useSidebarCollapsed()
  const collapsed = !drawer && foldedPref
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const counts: Record<Badge, number> = { mail: unreadMail.count, bank: needsLinking }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const name = currentUser?.name || currentUser?.email || ''
  return (
    <aside
      className={clsx(
        'flex h-full shrink-0 flex-col bg-ink-950 text-slate-300',
        // Animated, as in Raptor: a 176px snap reads as the page breaking, the same move animated reads as a drawer.
        'transition-[width] duration-200 ease-out',
        drawer ? 'w-72 max-w-[85vw]' : collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className={clsx('flex h-16 items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-5')}>
        {/* Folded, the wordmark would smear into 48px, so the rail shows the icon alone. */}
        <Link to={paths.dashboard()} onClick={onNavigate} aria-label="Dashboard" className="min-w-0">
          {collapsed ? (
            <img src={theme.icon} alt={theme.productName} className="h-8 w-8 rounded-md" />
          ) : theme.tagline ? (
            // The app's wordmark, with the company it is running for underneath (the skin's
            // default until Settings has loaded, then the company name from Settings).
            <span className="block">
              <img src={theme.lockupLight} alt={theme.productName} className="h-5 w-auto object-contain" />
              <span className="skin-eyebrow mt-1.5 block truncate text-[9.5px] font-medium text-white/55">
                {settings?.name || theme.tagline}
              </span>
            </span>
          ) : (
            <img src={theme.lockupLight} alt={settings?.name || 'Urban Haus Construction'} className="max-h-11 w-auto object-contain" />
          )}
        </Link>
      </div>

      <div className={clsx('pt-4', collapsed ? 'px-2' : 'px-3')}>
        <Link
          to={paths.capture()}
          onClick={onNavigate}
          title={collapsed ? 'Snap slip' : undefined}
          className={clsx(
            'flex items-center justify-center gap-2 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-500/30 hover:bg-brand-600',
            collapsed ? 'px-0' : 'px-3',
          )}
        >
          <Camera size={16} /> {!collapsed && 'Snap slip'}
        </Link>
      </div>

      <nav className={clsx('flex-1 space-y-0.5 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
        {NAV.map(({ to, label, icon: Icon, end, badge }) => {
          const count = badge ? counts[badge] : 0
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              // Folded, the label is the only thing naming the item, so it moves into a tooltip.
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                clsx(
                  'relative flex items-center gap-3 rounded-lg py-2.5 text-[13.5px] font-medium transition-colors',
                  collapsed ? 'justify-center px-0' : 'px-3',
                  isActive ? 'bg-brand-500 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={17} strokeWidth={2} className="shrink-0" />
                  {!collapsed && label}
                  {/* A count, never at zero. Folded there's no room for "38", so it becomes a dot. */}
                  {count > 0 &&
                    (collapsed ? (
                      <span title={`${count}`} className="absolute top-1 right-2 h-2 w-2 rounded-full bg-brand-400" />
                    ) : (
                      <span
                        className={clsx(
                          'ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                          isActive ? 'bg-white/20 text-white' : 'bg-brand-500 text-white',
                        )}
                      >
                        {count > 99 ? '99+' : count}
                      </span>
                    ))}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* The fold sits at the bottom, away from the logo people click to go home. Not on phones. */}
      {!drawer && (
        <div className={clsx('px-3 pb-1', collapsed && 'flex justify-center')}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            title={collapsed ? 'Widen the menu' : 'Narrow the menu'}
            className={clsx(
              'flex items-center gap-2.5 rounded-lg py-2 text-[12px] text-slate-400 transition-colors hover:bg-white/5 hover:text-white',
              collapsed ? 'w-10 justify-center px-0' : 'w-full px-3',
            )}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!collapsed && 'Narrow the menu'}
          </button>
        </div>
      )}

      <div ref={menuRef} className={clsx('relative border-t border-white/10', collapsed ? 'p-2' : 'p-3')}>
        {menuOpen && (
          <div className="absolute right-3 bottom-full left-3 z-50 mb-1.5 min-w-40 rounded-xl border border-slate-100 bg-white py-1.5 shadow-lg">
            <Link
              to={paths.settings()}
              onClick={() => { setMenuOpen(false); onNavigate?.() }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              <Settings size={14} /> Settings
            </Link>
            <button
              onClick={() => { setMenuOpen(false); void signOut() }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut size={14} /> Log out
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title={collapsed ? name : undefined}
          className={clsx(
            'flex w-full items-center gap-2.5 rounded-lg py-2 text-left transition-colors hover:bg-white/5',
            collapsed ? 'justify-center px-0' : 'px-2',
          )}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ background: currentUser?.avatar_color ?? '#475569' }}
          >
            {(name || '?').slice(0, 1).toUpperCase()}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-white">{currentUser?.name || 'Loading…'}</span>
                <span className="block truncate text-[11px] text-slate-400">{currentUser ? ROLE_LABEL[currentUser.role] ?? 'Team member' : ''}</span>
              </span>
              <ChevronDown size={14} className="shrink-0 text-slate-500" />
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
