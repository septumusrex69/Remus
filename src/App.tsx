import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './store/AuthContext'
import { RequireAuth } from './components/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import { LoginPage } from './pages/auth/LoginPage'
import { SetPasswordPage } from './pages/auth/SetPasswordPage'
import { BuildProvider } from './pages/build/BuildContext'
import { buildRoutes } from './pages/build/routes'
import { SignInOpening } from './components/opening/SignInOpening'

/* The client portal: outside the app (no staff login), its own small chunk. */
const PortalPage = lazy(() => import('./pages/portal/PortalPage'))
/* Remus's sign-in openings, replayable (Remus · Handoff 6, from Raptor S16). No data, so no sign-in. */
const OpeningPage = lazy(() => import('./pages/OpeningPage'))

function App() {
  return (
    <AuthProvider>
      {/* The opening after a sign-in, above the routes so the page changing under it never restarts it. */}
      <SignInOpening />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/opening" element={<Suspense fallback={null}><OpeningPage /></Suspense>} />
        <Route path="/portal" element={<Suspense fallback={null}><PortalPage /></Suspense>} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <BuildProvider>
                <AppLayout />
              </BuildProvider>
            </RequireAuth>
          }
        >
          {buildRoutes}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
