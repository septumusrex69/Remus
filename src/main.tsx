import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './store/ThemeContext'
import { registerServiceWorker } from './components/layout/UpdateBanner'
import { applySpellCheckAttribute } from './lib/spellCheck'
import { installGlobalErrorHandlers } from './lib/errorReporter'

registerServiceWorker()

/* Remus · Handover 8, from Raptor S18 and 55a7520: the spell-check switch (Settings -> Appearance) before the first box
   is drawn (index.html says on), and a crash anywhere is reported to the Administrators (lib/errorReporter.ts). */
applySpellCheckAttribute()
installGlobalErrorHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
