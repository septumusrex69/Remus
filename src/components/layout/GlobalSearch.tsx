import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import {
  contactName, invoices as invoicesApi, loadClientDirectory, projects as projectsApi, quotes as quotesApi, subcontractors as subsApi,
  workers as workersApi, type ClientDirectory,
} from '../../lib/api'
import { listRequests } from '../../lib/changeRequestsApi'
import { requestLabel, titleOf, type ChangeRequest } from '../../lib/changeRequests'
import { matchesAny, requestNumberOf } from '../../lib/globalSearch'
import { paths } from '../../pages/build/paths'
import type { Invoice, Project, Quote, Subcontractor, Worker } from '../../types'

interface Book {
  dir: ClientDirectory; projects: Project[]; quotes: Quote[]; invoices: Invoice[]
  workers: Worker[]; subs: Subcontractor[]; requests: ChangeRequest[]
}

interface Result {
  id: string
  label: string
  sub: string
  path: string
  kind: string
}

/**
 * Raptor's global search: one box in the top bar that finds everything (Raptor H13) -- clients and
 * people by name, email or phone, projects, quotes, invoices, requests (R-6), workers and
 * subcontractors. See lib/globalSearch.ts. The data is fetched the first time someone focuses the
 * box, not on every page load.
 * `compact` is the phone version: an icon that opens the box over the bar.
 */
export function GlobalSearch({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [data, setData] = useState<Book | null>(null)
  const loading = useRef(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function load() {
    if (data || loading.current) return
    loading.current = true
    /* A list that cannot be read (a role that may not see invoices) is empty, not the end of the search. */
    const or = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
    Promise.all([loadClientDirectory(), or(projectsApi.list()), or(quotesApi.list()), or(invoicesApi.list()), or(workersApi.list()), or(subsApi.list()), or(listRequests())])
      .then(([dir, projects, quotes, invoices, workers, subs, requests]) => setData({ dir, projects, quotes, invoices, workers, subs, requests }))
      .catch(() => {})
      .finally(() => { loading.current = false })
  }

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q || !data) return []
    const has = (...xs: (string | null | undefined)[]) => matchesAny(xs, q)
    const out: Result[] = []
    const asked = requestNumberOf(q)
    for (const r of data.requests) {
      if (asked === r.number || (asked === null && has(r.description, r.review_title))) {
        out.push({ id: r.id, label: titleOf(r), sub: `Request · ${requestLabel(r)}`, path: paths.requests(r.number), kind: 'request' })
      }
    }
    for (const c of data.dir.companies) {
      if (has(c.name, c.email, c.phone)) out.push({ id: c.id, label: c.name, sub: 'Company client', path: paths.company(c.id), kind: 'company' })
    }
    for (const p of data.dir.contacts) {
      const name = contactName(p)
      if (has(name, p.email, p.mobile, p.phone)) {
        const company = p.company_id ? data.dir.companyById.get(p.company_id)?.name : null
        out.push({ id: p.id, label: name, sub: company ? `Contact · ${company}` : 'Private client', path: paths.contact(p.id), kind: 'contact' })
      }
    }
    for (const p of data.projects) {
      if (has(p.name, p.code, p.site_address)) out.push({ id: p.id, label: p.name, sub: `Project${p.code ? ` · ${p.code}` : ''}`, path: paths.project(p.id), kind: 'project' })
    }
    for (const qu of data.quotes) {
      if (has(qu.title, qu.number, qu.site_address)) out.push({ id: qu.id, label: qu.title, sub: `Quote${qu.number ? ` · ${qu.number}` : ''}`, path: paths.quote(qu.id), kind: 'quote' })
    }
    for (const inv of data.invoices) {
      if (inv.project_id && has(inv.number, inv.description)) {
        const project = data.projects.find((p) => p.id === inv.project_id)
        out.push({ id: inv.id, label: inv.number ?? 'Invoice', sub: `Invoice${project ? ` · ${project.name}` : ''}`, path: paths.project(inv.project_id, 'invoices'), kind: 'invoice' })
      }
    }
    for (const w of data.workers) {
      if (has(w.name, w.trade, w.phone)) out.push({ id: w.id, label: w.name, sub: `Worker${w.trade ? ` · ${w.trade}` : ''}`, path: paths.workers(), kind: 'worker' })
    }
    for (const sc of data.subs) {
      if (has(sc.name, sc.trade, sc.contact_person, sc.phone, sc.email)) {
        out.push({ id: sc.id, label: sc.name, sub: `Subcontractor${sc.trade ? ` · ${sc.trade}` : ''}`, path: paths.subcontractors(), kind: 'subcontractor' })
      }
    }
    return out.slice(0, 12)
  }, [query, data])

  if (compact && !expanded) {
    return (
      <button onClick={() => { setExpanded(true); load() }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Search">
        <Search size={19} />
      </button>
    )
  }

  return (
    <div ref={ref} className={compact ? 'fixed inset-x-3 top-3 z-50' : 'relative w-full max-w-sm'}>
      <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 focus-within:ring-2 focus-within:ring-brand-500/40">
        <Search size={16} className="shrink-0 text-slate-400" />
        <input
          value={query}
          autoFocus={compact}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { setOpen(true); load() }}
          placeholder="Search clients, phone numbers, quotes, invoices, R-numbers…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
        {(query || compact) && (
          <button onClick={() => { setQuery(''); if (compact) setExpanded(false) }} className="text-slate-400 hover:text-slate-600" aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </div>
      {open && query && (
        <div className="absolute top-full right-0 left-0 z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-slate-100 bg-white py-2 shadow-lg">
          {!data ? (
            <p className="px-4 py-3 text-sm text-slate-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">No results for "{query}"</p>
          ) : (
            results.map((r) => (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => { navigate(r.path); setOpen(false); setExpanded(false); setQuery('') }}
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50"
              >
                <span className="truncate text-sm font-medium text-slate-700">{r.label}</span>
                <span className="shrink-0 text-xs text-slate-400">{r.sub}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
