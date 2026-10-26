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
  projects: () => p('/projects'),
  project: (id: string, tab?: string) => p(`/projects/${id}${tab ? `?tab=${tab}` : ''}`),
  expenses: () => p('/expenses'),
  capture: () => p('/expenses/capture'),
  diary: () => p('/diary'),
  bank: () => p('/bank'),
  finance: () => p('/finance'),
  /** Settings, optionally on one tab (Raptor's ?tab= links), e.g. paths.settings('Integrations'). */
  settings: (tab?: string) => p(tab ? `/settings?tab=${encodeURIComponent(tab)}` : '/settings'),
}
