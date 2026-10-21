import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './store/AuthContext'
import { RequireAuth } from './components/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import { LoginPage } from './pages/auth/LoginPage'
import { SetPasswordPage } from './pages/auth/SetPasswordPage'
import { BuildProvider } from './pages/build/BuildContext'
import { buildRoutes } from './pages/build/routes'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
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
