import { lazy } from 'react'
import { Route, useParams } from 'react-router-dom'
import { Allow } from '../../components/Allow'
import { editsQuotes, seesMoney, seesQuotes, sendsNews, snapsSlips } from '../../lib/access'
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
  PhotosPage: () => import('./photos/PhotosPage'),
  SlipTestPage: () => import('./slips/SlipTestPage'),
  BrandBoardPage: () => import('./brand/BrandBoardPage'),
  OpsPage: () => import('./ops/OpsPage'),
  ProductsPage: () => import('./products/ProductsPage'),
  ReturnsPage: () => import('./returns/ReturnsPage'),
  PhotoDaysPage: () => import('./photos/PhotoDaysPage'),
  TasksPage: () => import('./tasks/TasksPage'),
  CalendarPage: () => import('./calendar/CalendarPage'),
  ActivitiesPage: () => import('./activities/ActivitiesPage'),
  // Remus · Handover 8: reports.
  ReportsPage: () => import('./reports/ReportsPage'),
  LibraryPage: () => import('./library/LibraryPage'),
  NewsPage: () => import('../news/NewsPage'),
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
const ProductsPage = lazy(() => pages.ProductsPage().then((x) => ({ default: x.ProductsPage })))
const PhotoDaysPage = lazy(() => pages.PhotoDaysPage().then((x) => ({ default: x.PhotoDaysPage })))
const NewsPage = lazy(() => pages.NewsPage().then((x) => ({ default: x.NewsPage })))
const ReturnsPage = lazy(() => pages.ReturnsPage().then((x) => ({ default: x.ReturnsPage })))
const OpsPage = lazy(() => pages.OpsPage().then((x) => ({ default: x.OpsPage })))
const BrandBoardPage = lazy(() => pages.BrandBoardPage().then((x) => ({ default: x.BrandBoardPage })))
const PhotosPage = lazy(() => pages.PhotosPage().then((x) => ({ default: x.PhotosPage })))
const SlipTestPage = lazy(() => pages.SlipTestPage().then((x) => ({ default: x.SlipTestPage })))
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
const TasksPage = lazy(() => pages.TasksPage().then((x) => ({ default: x.TasksPage })))
const CalendarPage = lazy(() => pages.CalendarPage().then((x) => ({ default: x.CalendarPage })))
const ActivitiesPage = lazy(() => pages.ActivitiesPage().then((x) => ({ default: x.ActivitiesPage })))
const ReportsPage = lazy(() => pages.ReportsPage().then((x) => ({ default: x.ReportsPage })))
const LibraryPage = lazy(() => pages.LibraryPage().then((x) => ({ default: x.LibraryPage })))

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
    {/* Remus · Handover 8: returns -- for the people who snap slips. */}
    <Route path="returns" element={<Allow when={(_a, p) => snapsSlips(p)}><ReturnsPage /></Allow>} />
    <Route path="diary" element={<DiaryPage />} />
    <Route path="bank" element={<Allow when={seesMoney}><BankPage /></Allow>} />
    <Route path="finance" element={<Allow when={seesMoney}><FinancePage /></Allow>} />
    <Route path="mail" element={<MailPage />} />
    <Route path="settings" element={<SettingsPage />} />
    {/* Remus · Handover 6: choosing the Unsplash photographs (anybody may look; Administrators choose). */}
    <Route path="photos" element={<PhotosPage />} />
    {/* Remus · Handover 8: the photo of the day, a month at a time (anybody may look; Administrators approve). */}
    <Route path="photo-days" element={<PhotoDaysPage />} />
    <Route path="slip-test" element={<SlipTestPage />} />
    <Route path="brand" element={<BrandBoardPage />} />
    {/* Remus · Handover 6: the dark Operations board (map, job card, gauges). Everybody; money parts follow access. */}
    <Route path="ops" element={<OpsPage />} />
    {/* Remus · Handover 6: the products book (what we prefer, what we avoid). */}
    <Route path="products" element={<ProductsPage />} />
    {/* WHO SEES WHAT (lib/access.ts): money pages for Administrators; quotes not for site managers. */}
    {/* CHANGE REQUESTS (copied from Raptor): open to everybody -- "anyone can see requests". */}
    <Route path="requests" element={<RequestsPage />} />
    {/* Remus · Handover 8, from Raptor: tasks, one calendar, the activity log. Everybody's; none holds money. */}
    <Route path="tasks" element={<TasksPage />} />
    <Route path="calendar" element={<CalendarPage />} />
    <Route path="activities" element={<ActivitiesPage />} />
    {/* Remus · Handover 8: reports are money (seesMoney). */}
    <Route path="reports" element={<Allow when={seesMoney}><ReportsPage /></Allow>} />
    {/* Remus · Handover 8: the Library (templates, letterhead). Everybody reads; an Administrator writes. */}
    <Route path="library" element={<LibraryPage />} />
    {/* Remus · Handover 8: News -- newsletters to clients, for Administrators (one newsletter is ?c=<id>). */}
    <Route path="news" element={<Allow when={sendsNews}><NewsPage /></Allow>} />
  </>
)
