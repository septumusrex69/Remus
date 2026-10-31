/**
 * Every link in the construction section goes through here. Remus mounts the section at the
 * root; inside Raptor set BUILD_BASE to '/build' and mount `buildRoutes` under it.
 */
export const BUILD_BASE = ''

const p = (s: string) => `${BUILD_BASE}${s}` || '/'

export const paths = {
  dashboard: () => p('/'),
  mail: () => p('/mail'),
  quotes: () => p('/quotes'),
  quote: (id: string) => p(`/quotes/${id}`),
  quotePrint: (id: string) => p(`/quotes/${id}/print`),
  clients: () => p('/clients'),
  company: (id: string) => p(`/clients/company/${id}`),
  contact: (id: string) => p(`/clients/contact/${id}`),
  subcontractors: () => p('/subcontractors'),
  workers: () => p('/workers'),
  /** The crew register (?tab=wages&day=yyyy-mm-dd). */
  crew: (tab?: 'wages') => p(tab ? `/crew?tab=${tab}` : '/crew'),
  schedule: () => p('/schedule'),
  projects: () => p('/projects'),
  project: (id: string, tab?: string) => p(`/projects/${id}${tab ? `?tab=${tab}` : ''}`),
  expenses: () => p('/expenses'),
  capture: () => p('/expenses/capture'),
  diary: () => p('/diary'),
  bank: () => p('/bank'),
  finance: () => p('/finance'),
  /** The Feedback Centre, optionally with one request open (?r=12, what every notification links to). */
  requests: (n?: number) => p(n ? `/requests?r=${n}` : '/requests'),
  /** Settings, optionally on one tab (Raptor's ?tab= links), e.g. paths.settings('Integrations'). */
  /** The Unsplash photographs and where each is used (Remus · Handover 6). */
  photos: () => p('/photos'),
  /** The Platinum brand board (Remus · Handover 6). */
  brand: () => p('/brand'),
  settings: (tab?: string) => p(tab ? `/settings?tab=${encodeURIComponent(tab)}` : '/settings'),
}
