import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, Plus, Search, User } from 'lucide-react'
import { contactName, loadClientDirectory, projects as projectsApi } from '../../../lib/api'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '../../../components/ui'
import { NewClientModal } from '../components/ClientPicker'
import { paths } from '../paths'

interface Row {
  kind: 'company' | 'individual'
  id: string
  name: string
  sub: string
  projects: number
}

export function ClientsList() {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)

  // The top bar's "+ Add" lands here with ?new=1: open the form, then drop the flag so a refresh doesn't reopen it.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    if (params.get('new') !== '1') return
    setCreating(true)
    setParams((p) => { p.delete('new'); return p }, { replace: true })
  }, [params, setParams])
  const { data, error, loading, reload } = useLoad(async () => {
    const [dir, projects] = await Promise.all([loadClientDirectory(), projectsApi.list()])
    return { dir, projects }
  }, [], 'clients')

  const rows = useMemo<Row[]>(() => {
    if (!data) return []
    const { dir, projects } = data
    const out: Row[] = [
      ...dir.companies.map((c) => ({
        kind: 'company' as const,
        id: c.id,
        name: c.name,
        sub: [c.city, c.phone, c.email].filter(Boolean).join(' · '),
        projects: projects.filter((p) => p.company_id === c.id).length,
      })),
      ...dir.contacts
        .filter((c) => !c.company_id)
        .map((c) => ({
          kind: 'individual' as const,
          id: c.id,
          name: contactName(c),
          sub: [c.mobile ?? c.phone, c.email].filter(Boolean).join(' · '),
          projects: projects.filter((p) => p.contact_id === c.id && !p.company_id).length,
        })),
    ]
    const needle = q.trim().toLowerCase()
    return out.filter((r) => !needle || `${r.name} ${r.sub}`.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name))
  }, [data, q])

  return (
    <div>
      <PageHeader title="Clients" subtitle="Companies and private individuals" actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New client</Button>} />
      <ErrorBanner error={error} />
      <div className="relative mb-3 sm:w-72">
        <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card padded={false}>
        {loading && !data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No clients yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={`${r.kind}:${r.id}`}>
                <Link to={r.kind === 'company' ? paths.company(r.id) : paths.contact(r.id)} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${r.kind === 'company' ? 'bg-slate-900 text-brand-400' : 'bg-brand-100 text-brand-700'}`}>
                    {r.kind === 'company' ? <Building2 size={16} /> : <User size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{r.name}</span>
                    <span className="block truncate text-xs text-slate-500">{r.kind === 'company' ? 'Company' : 'Private'}{r.sub ? ` · ${r.sub}` : ''}</span>
                  </span>
                  <span className="text-xs text-slate-500">{r.projects} project{r.projects === 1 ? '' : 's'}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <NewClientModal open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />
    </div>
  )
}
