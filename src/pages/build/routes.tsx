import { lazy } from 'react'
import { Route } from 'react-router-dom'

// Each page loads on demand (charts in particular are heavy); AppLayout supplies the Suspense boundary.
const DashboardPage = lazy(() => import('./dashboard/DashboardPage').then((x) => ({ default: x.DashboardPage })))
const QuotesList = lazy(() => import('./quotes/QuotesList').then((x) => ({ default: x.QuotesList })))
const QuoteEditor = lazy(() => import('./quotes/QuoteEditor').then((x) => ({ default: x.QuoteEditor })))
const QuotePrint = lazy(() => import('./quotes/QuotePrint').then((x) => ({ default: x.QuotePrint })))
const ClientsList = lazy(() => import('./clients/ClientsList').then((x) => ({ default: x.ClientsList })))
const ClientDetail = lazy(() => import('./clients/ClientDetail').then((x) => ({ default: x.ClientDetail })))
const ProjectsList = lazy(() => import('./projects/ProjectsList').then((x) => ({ default: x.ProjectsList })))
const ProjectDetail = lazy(() => import('./projects/ProjectDetail').then((x) => ({ default: x.ProjectDetail })))
const ExpensesPage = lazy(() => import('./expenses/ExpensesPage').then((x) => ({ default: x.ExpensesPage })))
const SlipCapture = lazy(() => import('./expenses/SlipCapture').then((x) => ({ default: x.SlipCapture })))
const DiaryPage = lazy(() => import('./diary/DiaryPage').then((x) => ({ default: x.DiaryPage })))
const BankPage = lazy(() => import('./bank/BankPage').then((x) => ({ default: x.BankPage })))
const FinancePage = lazy(() => import('./finance/FinancePage').then((x) => ({ default: x.FinancePage })))
const SettingsPage = lazy(() => import('./settings/SettingsPage').then((x) => ({ default: x.SettingsPage })))

/**
 * The construction section as a fragment of <Route>s, relative paths only, so Raptor can mount
 * it under its own layout: <Route path="/build" element={<BuildProvider><Outlet/></BuildProvider>}>{buildRoutes}</Route>
 * (and set BUILD_BASE in paths.ts to '/build').
 */
export const buildRoutes = (
  <>
    <Route index element={<DashboardPage />} />
    <Route path="quotes" element={<QuotesList />} />
    <Route path="quotes/:id" element={<QuoteEditor />} />
    <Route path="quotes/:id/print" element={<QuotePrint />} />
    <Route path="clients" element={<ClientsList />} />
    <Route path="clients/company/:id" element={<ClientDetail kind="company" />} />
    <Route path="clients/contact/:id" element={<ClientDetail kind="contact" />} />
    <Route path="projects" element={<ProjectsList />} />
    <Route path="projects/:id" element={<ProjectDetail />} />
    <Route path="expenses" element={<ExpensesPage />} />
    <Route path="expenses/capture" element={<SlipCapture />} />
    <Route path="diary" element={<DiaryPage />} />
    <Route path="bank" element={<BankPage />} />
    <Route path="finance" element={<FinancePage />} />
    <Route path="settings" element={<SettingsPage />} />
  </>
)
