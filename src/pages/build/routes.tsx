import { lazy } from 'react'
import { Route, useParams } from 'react-router-dom'
import { Allow } from '../../components/Allow'
import { editsQuotes, seesMoney, seesQuotes, snapsSlips } from '../../lib/access'
import { paths as P } from './paths'

// Each page loads on demand (charts in particular are heavy); AppLayout supplies the Suspense boundary.
const pages = {
  DashboardPage: () => import('./dashboard/DashboardPage'),
  QuotesList: () => import('./quotes/QuotesList'),
  QuoteEditor: () => import('./quotes/QuoteEditor'),
  QuotePrint: () => import('./quotes/QuotePrint'),
  ClientsList: () => import('./clients/ClientsList'),
  ClientDetail: () => import('./clients/ClientDetail'),
  SubcontractorsPage: () => import('./subcontractors/SubcontractorsPage'),
  WorkersPage: () => import('./workers/WorkersPage'),
  CrewRegisterPage: () => import('./crew/CrewRegisterPage'),
  SchedulePage: () => import('./schedule/SchedulePage'),
  ProjectsList: () => import('./projects/ProjectsList'),
  ProjectDetail: () => import('./projects/ProjectDetail'),
  ExpensesPage: () => import('./expenses/ExpensesPage'),
  SlipCapture: () => import('./expenses/SlipCapture'),
  DiaryPage: () => import('./diary/DiaryPage'),
  BankPage: () => import('./bank/BankPage'),
  FinancePage: () => import('./finance/FinancePage'),
  SettingsPage: () => import('./settings/SettingsPage'),
  MailPage: () => import('./mail/MailPage'),
  RequestsPage: () => import('../requests/RequestsPage'),
}

const DashboardPage = lazy(() => pages.DashboardPage().then((x) => ({ default: x.DashboardPage })))
const QuotesList = lazy(() => pages.QuotesList().then((x) => ({ default: x.QuotesList })))
const QuoteEditor = lazy(() => pages.QuoteEditor().then((x) => ({ default: x.QuoteEditor })))
const QuotePrint = lazy(() => pages.QuotePrint().then((x) => ({ default: x.QuotePrint })))
const ClientsList = lazy(() => pages.ClientsList().then((x) => ({ default: x.ClientsList })))
const ClientDetail = lazy(() => pages.ClientDetail().then((x) => ({ default: x.ClientDetail })))
const SubcontractorsPage = lazy(() => pages.SubcontractorsPage().then((x) => ({ default: x.SubcontractorsPage })))
const WorkersPage = lazy(() => pages.WorkersPage().then((x) => ({ default: x.WorkersPage })))
const CrewRegisterPage = lazy(() => pages.CrewRegisterPage().then((x) => ({ default: x.CrewRegisterPage })))
const SchedulePage = lazy(() => pages.SchedulePage().then((x) => ({ default: x.SchedulePage })))
const ProjectsList = lazy(() => pages.ProjectsList().then((x) => ({ default: x.ProjectsList })))
const ProjectDetail = lazy(() => pages.ProjectDetail().then((x) => ({ default: x.ProjectDetail })))
const ExpensesPage = lazy(() => pages.ExpensesPage().then((x) => ({ default: x.ExpensesPage })))
const SlipCapture = lazy(() => pages.SlipCapture().then((x) => ({ default: x.SlipCapture })))
const DiaryPage = lazy(() => pages.DiaryPage().then((x) => ({ default: x.DiaryPage })))
const BankPage = lazy(() => pages.BankPage().then((x) => ({ default: x.BankPage })))
const FinancePage = lazy(() => pages.FinancePage().then((x) => ({ default: x.FinancePage })))
const MailPage = lazy(() => pages.MailPage().then((x) => ({ default: x.MailPage })))
const RequestsPage = lazy(() => pages.RequestsPage().then((x) => ({ default: x.RequestsPage })))
const SettingsPage = lazy(() => pages.SettingsPage().then((x) => ({ default: x.SettingsPage })))

/** The quote editor carries costs and markup: a contractor reads the quote as the client does. */
function QuoteEditorOrPrint() {
  const { id = '' } = useParams()
  return <Allow when={editsQuotes} otherwise={seesQuotesPath(id)}><QuoteEditor /></Allow>
}
const seesQuotesPath = (id: string) => P.quotePrint(id)
const notSiteManager = seesQuotes

/**
 * Fetches the everyday pages' code in the background once the app is idle, so the first visit to
 * each one doesn't wait on a download. Charts load with them (dashboard, project, finance).
 */
export function preloadPages() {
  for (const load of [pages.DashboardPage, pages.MailPage, pages.ProjectsList, pages.ProjectDetail, pages.QuotesList, pages.QuoteEditor, pages.ExpensesPage, pages.SlipCapture, pages.BankPage, pages.DiaryPage, pages.ClientsList]) {
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
    <Route path="quotes" element={<Allow when={seesQuotes}><QuotesList /></Allow>} />
    <Route path="quotes/:id" element={<QuoteEditorOrPrint />} />
    <Route path="quotes/:id/print" element={<Allow when={seesQuotes}><QuotePrint /></Allow>} />
    <Route path="clients" element={<ClientsList />} />
    <Route path="clients/company/:id" element={<ClientDetail kind="company" />} />
    <Route path="clients/contact/:id" element={<ClientDetail kind="contact" />} />
    <Route path="subcontractors" element={<Allow when={notSiteManager}><SubcontractorsPage /></Allow>} />
    <Route path="workers" element={<WorkersPage />} />
    <Route path="crew" element={<CrewRegisterPage />} />
    <Route path="schedule" element={<SchedulePage />} />
    <Route path="projects" element={<ProjectsList />} />
    <Route path="projects/:id" element={<ProjectDetail />} />
    <Route path="expenses" element={<Allow when={seesMoney}><ExpensesPage /></Allow>} />
    <Route path="expenses/capture" element={<Allow when={(_a, p) => snapsSlips(p)}><SlipCapture /></Allow>} />
    <Route path="diary" element={<DiaryPage />} />
    <Route path="bank" element={<Allow when={seesMoney}><BankPage /></Allow>} />
    <Route path="finance" element={<Allow when={seesMoney}><FinancePage /></Allow>} />
    <Route path="mail" element={<MailPage />} />
    <Route path="settings" element={<SettingsPage />} />
    {/* WHO SEES WHAT (lib/access.ts): money pages for Administrators; quotes not for site managers. */}
    {/* CHANGE REQUESTS (copied from Raptor): open to everybody -- "anyone can see requests". */}
    <Route path="requests" element={<RequestsPage />} />
  </>
)
