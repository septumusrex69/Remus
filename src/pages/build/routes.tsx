import { lazy } from 'react'
import { Route } from 'react-router-dom'

// Each page loads on demand (charts in particular are heavy); AppLayout supplies the Suspense boundary.
const pages = {
  DashboardPage: () => import('./dashboard/DashboardPage'),
  QuotesList: () => import('./quotes/QuotesList'),
  QuoteEditor: () => import('./quotes/QuoteEditor'),
  QuotePrint: () => import('./quotes/QuotePrint'),
  ClientsList: () => import('./clients/ClientsList'),
  ClientDetail: () => import('./clients/ClientDetail'),
  ProjectsList: () => import('./projects/ProjectsList'),
  ProjectDetail: () => import('./projects/ProjectDetail'),
  ExpensesPage: () => import('./expenses/ExpensesPage'),
  SlipCapture: () => import('./expenses/SlipCapture'),
  DiaryPage: () => import('./diary/DiaryPage'),
  BankPage: () => import('./bank/BankPage'),
  FinancePage: () => import('./finance/FinancePage'),
  SettingsPage: () => import('./settings/SettingsPage'),
}

const DashboardPage = lazy(() => pages.DashboardPage().then((x) => ({ default: x.DashboardPage })))
const QuotesList = lazy(() => pages.QuotesList().then((x) => ({ default: x.QuotesList })))
const QuoteEditor = lazy(() => pages.QuoteEditor().then((x) => ({ default: x.QuoteEditor })))
const QuotePrint = lazy(() => pages.QuotePrint().then((x) => ({ default: x.QuotePrint })))
const ClientsList = lazy(() => pages.ClientsList().then((x) => ({ default: x.ClientsList })))
const ClientDetail = lazy(() => pages.ClientDetail().then((x) => ({ default: x.ClientDetail })))
const ProjectsList = lazy(() => pages.ProjectsList().then((x) => ({ default: x.ProjectsList })))
const ProjectDetail = lazy(() => pages.ProjectDetail().then((x) => ({ default: x.ProjectDetail })))
const ExpensesPage = lazy(() => pages.ExpensesPage().then((x) => ({ default: x.ExpensesPage })))
const SlipCapture = lazy(() => pages.SlipCapture().then((x) => ({ default: x.SlipCapture })))
const DiaryPage = lazy(() => pages.DiaryPage().then((x) => ({ default: x.DiaryPage })))
const BankPage = lazy(() => pages.BankPage().then((x) => ({ default: x.BankPage })))
const FinancePage = lazy(() => pages.FinancePage().then((x) => ({ default: x.FinancePage })))
const SettingsPage = lazy(() => pages.SettingsPage().then((x) => ({ default: x.SettingsPage })))

/**
 * Fetches the everyday pages' code in the background once the app is idle, so the first visit to
 * each one doesn't wait on a download. Charts load with them (dashboard, project, finance).
 */
export function preloadPages() {
  for (const load of [pages.DashboardPage, pages.ProjectsList, pages.ProjectDetail, pages.QuotesList, pages.QuoteEditor, pages.ExpensesPage, pages.SlipCapture, pages.BankPage, pages.DiaryPage, pages.ClientsList]) {
    load().catch(() => {}) // offline or a new deploy: the page simply loads on click instead
  }
  import('./components/charts').catch(() => {})
}

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
