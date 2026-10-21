import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  Banknote,
  CalendarDays,
  Camera,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Receipt,
  Settings,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../../store/AuthContext'
import { useBuild } from '../../pages/build/BuildContext'
import { paths } from '../../pages/build/paths'

const NAV = [
  { to: paths.dashboard(), label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: paths.quotes(), label: 'Quotes', icon: FileText },
  { to: paths.projects(), label: 'Projects', icon: FolderKanban },
  { to: paths.clients(), label: 'Clients', icon: Users },
  { to: paths.expenses(), label: 'Expenses', icon: Receipt },
  { to: paths.bank(), label: 'Bank', icon: Banknote, badge: 'bank' as const },
  { to: paths.diary(), label: 'Diary', icon: CalendarDays },
  { to: paths.finance(), label: 'Finance', icon: LineChart },
  { to: paths.settings(), label: 'Settings', icon: Settings },
]

/** Urban Haus Construction logo: `onDark` uses the white-lettered version. */
export function Logo({ className, onDark }: { className?: string; onDark?: boolean }) {
  return (
    <img
      src={onDark ? '/brand/urban-haus-logo-white.png' : '/brand/urban-haus-logo.png'}
      alt="Urban Haus Construction"
      className={clsx('h-auto w-auto object-contain', className)}
    />
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { currentUser, signOut } = useAuth()
  const { needsLinking, settings } = useBuild()
  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="px-5 pt-5 pb-4 text-white">
        <Logo onDark className="max-h-16 max-w-[11rem]" />
        <p className="mt-1.5 truncate text-xs text-slate-400">Remus{settings?.name && settings.name !== 'My Construction Co' ? ` · ${settings.name}` : ''}</p>
      </div>
      <div className="px-3 pb-3">
        <Link
          to={paths.capture()}
          onClick={onNavigate}
          className="flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2.5 text-sm font-semibold text-slate-950 hover:bg-brand-400"
        >
          <Camera size={16} /> Snap slip
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60 hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon size={17} className={isActive ? 'text-brand-400' : 'text-slate-400'} />
                <span className="flex-1">{item.label}</span>
                {item.badge === 'bank' && needsLinking > 0 && (
                  <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[11px] font-semibold text-slate-950" title="Bank lines needing linking">
                    {needsLinking}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ background: currentUser?.avatar_color ?? '#475569' }}
          >
            {(currentUser?.name || currentUser?.email || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white">{currentUser?.name || 'Loading…'}</p>
            <p className="truncate text-xs text-slate-400">{currentUser?.email}</p>
          </div>
          <button onClick={() => signOut()} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" title="Sign out" aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function AppLayout() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const isPrint = location.pathname.endsWith('/print')
  const isCapture = location.pathname === paths.capture()

  if (isPrint)
    return (
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    )

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} className="-ml-1 rounded-md p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
          <Menu size={20} />
        </button>
        <Logo className="h-9" />
        <span className="w-8" />
      </header>

      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute top-4 right-3 z-10 rounded-md p-1 text-slate-400 hover:text-white" aria-label="Close menu">
              <X size={18} />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:py-8">
        <Suspense fallback={<div className="py-12 text-center text-sm text-slate-400">Loading…</div>}>
          <Outlet />
        </Suspense>
      </main>

      {/* Site managers live on their phones: slip capture is one thumb away everywhere. */}
      {!isCapture && (
        <Link
          to={paths.capture()}
          className="no-print fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full bg-brand-500 px-5 py-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-brand-500/30 lg:hidden"
          aria-label="Snap slip"
        >
          <Camera size={18} /> Snap slip
        </Link>
      )}
    </div>
  )
}
