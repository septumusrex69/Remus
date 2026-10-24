import { Suspense, useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { clsx } from 'clsx'
import { Camera } from 'lucide-react'
import { paths } from '../../pages/build/paths'
import { preloadPages } from '../../pages/build/routes'
import { Spinner } from '../ui'
import { ErrorBoundary } from '../ErrorBoundary'
import { Sidebar } from './Sidebar'
import { useTheme } from '../../store/ThemeContext'
import { Topbar } from './Topbar'

/** The skin's logo (REMUS, or Urban Haus on Classic): `onDark` uses the white version. */
export function Logo({ className, onDark }: { className?: string; onDark?: boolean }) {
  const { theme } = useTheme()
  return (
    <img
      src={onDark ? theme.lockupLight : theme.lockupDark}
      alt={theme.productName}
      className={clsx('h-auto w-auto object-contain', className)}
    />
  )
}

/**
 * The heading in the top bar for each screen (Raptor's AppLayout TITLES). Specific before general,
 * so /quotes/:id is "Quote", not "Quotes". No fallback: a wrong heading is worse than none.
 */
const TITLES: { test: RegExp; title: string }[] = [
  { test: /^\/$/, title: 'Dashboard' },
  { test: /^\/mail/, title: 'Mail' },
  { test: /^\/quotes\/[^/]+/, title: 'Quote' },
  { test: /^\/quotes/, title: 'Quotes' },
  { test: /^\/projects\/[^/]+/, title: 'Project' },
  { test: /^\/projects/, title: 'Projects' },
  { test: /^\/clients\/(company|contact)\//, title: 'Client details' },
  { test: /^\/clients/, title: 'Clients' },
  { test: /^\/expenses\/capture/, title: 'Snap slip' },
  { test: /^\/expenses/, title: 'Expenses' },
  { test: /^\/bank/, title: 'Bank' },
  { test: /^\/diary/, title: 'Diary' },
  { test: /^\/finance/, title: 'Finance' },
  { test: /^\/settings/, title: 'Settings' },
]

/**
 * Raptor's frame: a sidebar that folds to a rail, and a top bar over a scrolling page. On a phone
 * the sidebar becomes a slide-out drawer and slip capture is one thumb away.
 */
export function AppLayout() {
  // Once the first page is up, fetch the other pages' code in the background.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500))
    idle(() => preloadPages())
  }, [])
  const [drawer, setDrawer] = useState(false)
  const location = useLocation()
  const isPrint = location.pathname.endsWith('/print')
  const isCapture = location.pathname === paths.capture()
  const title = TITLES.find((t) => t.test.test(location.pathname))?.title ?? ''

  useEffect(() => setDrawer(false), [location.pathname])

  if (isPrint)
    return (
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    )

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <div className="no-print hidden lg:flex">
        <Sidebar />
      </div>

      {drawer && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 shadow-xl">
            <Sidebar drawer onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenu={() => setDrawer(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-5 pb-24 sm:px-6 lg:p-6 lg:pb-10">
            <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<Spinner page />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Site managers live on their phones: slip capture is one thumb away everywhere. */}
      {!isCapture && (
        <Link
          to={paths.capture()}
          className="no-print fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full bg-brand-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 lg:hidden"
          aria-label="Snap slip"
        >
          <Camera size={18} /> Snap slip
        </Link>
      )}
    </div>
  )
}
