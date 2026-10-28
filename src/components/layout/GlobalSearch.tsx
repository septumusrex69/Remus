import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import {
  clientLabel, contactName, invoices as invoicesApi, loadClientDirectory, projects as projectsApi, quotes as quotesApi,
  subcontractors as subcontractorsApi, workers as workersApi, type ClientDirectory,
} from '../../lib/api'
import { matchesAny, requestNumberIn } from '../../lib/globalSearch'
import { supabase } from '../../lib/supabase'
import { paths } from '../../pages/build/paths'
import type { Invoice, Project, Quote, Subcontractor, Worker } from '../../types'

interface Data { dir: ClientDirectory; projects: Project[]; quotes: Quote[]; invoices: Invoice[]; workers: Worker[]; subcontractors: Subcontractor[] }

interface Result {
  id: string
  label: string
  sub: string
  path: string
  kind: string
}

/**
 * Raptor's global search: one box in the top bar that finds anything -- clients, people, projects,
 * quotes, invoices, workers, subcontractors -- by name, phone, email, number or address, and a
 * change request by its R-number (Raptor · Handoff 14; see lib/globalSearch.ts).
 * The data is fetched the first time someone focuses the box, not on every page load.
 * `compact` is the phone version: an icon that opens the box over the bar.
 */
export function GlobalSearch({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [data, setData] = useState<Data | null>(null)
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
    // Invoices, workers and subcontractors are extras: one that cannot be read (a role without
    // access) leaves the rest of the box working.
    const extra = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
    Promise.all([loadClientDirectory(), projectsApi.list(), quotesApi.list(), extra(invoicesApi.list()), extra(workersApi.list()), extra(subcontractorsApi.list())])
      .then(([dir, projects, quotes, invoices, workers, subcontractors]) => setData({ dir, projects, quotes, invoices, workers, subcontractors }))
      .catch(() => {})
      .finally(() => { loading.current = false })
  }

  /* A change request by its number (R-6): asked of the database, as Raptor's global_search does. */
  const [request, setRequest] = useState<Result | null>(null)
  useEffect(() => {
    const n = requestNumberIn(query)
    setRequest(null)
    if (n === null) return
    let live = true
    void supabase.from('change_requests').select('id, number, review_title, description').eq('number', n).maybeSingle()
      .then(({ data: r }) => {
        if (live && r) setRequest({ id: r.id, label: `R-${r.number}`, sub: (r.review_title || r.description || '').slice(0, 80), path: paths.requests(r.number), kind: 'Request' })
      })
    return () => { live = false }
  }, [query])

  const results = useMemo<Result[]>(() => {
    const q = query.trim()
    if (!q || !data) return []
    const out: Result[] = []
    const client = (r: { company_id: string | null; contact_id: string | null }) => clientLabel(data.dir, r)
    for (const c of data.dir.companies) {
      if (matchesAny([c.name, c.email, c.phone, c.website, c.vat_no, c.reg_no, c.address, c.city], q)) {
        out.push({ id: c.id, label: c.name, sub: 'Company client', path: paths.company(c.id), kind: 'Client' })
      }
    }
    for (const p of data.dir.contacts) {
      const name = contactName(p)
      if (matchesAny([p.first_name, p.last_name, p.email, p.mobile, p.phone, p.id_number, p.address], q)) {
        const company = p.company_id ? data.dir.companyById.get(p.company_id)?.name : null
        out.push({ id: p.id, label: name, sub: company ? `Contact · ${company}` : 'Private client', path: paths.contact(p.id), kind: 'Person' })
      }
    }
    for (const p of data.projects) {
      if (matchesAny([p.name, p.code, p.site_address, client(p)], q)) {
        out.push({ id: p.id, label: p.name, sub: [p.code, client(p)].filter(Boolean).join(' · '), path: paths.project(p.id), kind: 'Project' })
      }
    }
    for (const qu of data.quotes) {
      if (matchesAny([qu.title, qu.number, qu.site_address, client(qu)], q)) {
        out.push({ id: qu.id, label: qu.title, sub: [qu.number, client(qu)].filter(Boolean).join(' · '), path: paths.quote(qu.id), kind: 'Quote' })
      }
    }
    for (const inv of data.invoices) {
      if (matchesAny([inv.number, inv.description, client(inv)], q)) {
        out.push({
          id: inv.id, label: inv.number || 'Invoice', sub: [inv.description, client(inv)].filter(Boolean).join(' · '),
          path: inv.project_id ? paths.project(inv.project_id, 'invoices') : paths.finance(), kind: 'Invoice',
        })
      }
    }
    for (const w of data.workers) {
      if (matchesAny([w.name, w.trade, w.phone], q)) out.push({ id: w.id, label: w.name, sub: w.trade ?? 'Worker', path: paths.workers(), kind: 'Worker' })
    }
    for (const s of data.subcontractors) {
      if (matchesAny([s.name, s.trade, s.contact_person, s.phone, s.email, s.vat_no], q)) {
        out.push({ id: s.id, label: s.name, sub: [s.trade, s.contact_person].filter(Boolean).join(' · ') || 'Subcontractor', path: paths.subcontractors(), kind: 'Subcontractor' })
      }
    }
    return out.slice(0, 12)
  }, [query, data])
  const shown = useMemo(() => (request ? [request, ...results] : results), [request, results])

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
          placeholder="Search names, numbers, phones, emails, addresses…"
          data-testid="global-search"
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
          {!data && shown.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">Searching…</p>
          ) : shown.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-400">No results for "{query}"</p>
          ) : (
            shown.map((r) => (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => { navigate(r.path); setOpen(false); setExpanded(false); setQuery('') }}
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50"
                data-testid="global-search-result" data-kind={r.kind}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-700">{r.label}</span>
                  {r.sub && <span className="block truncate text-xs text-slate-400">{r.sub}</span>}
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">{r.kind}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
