import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderKanban, Plus } from 'lucide-react'
import { clientLabel, listProjectFinancials, loadClientDirectory, projects as projectsApi } from '../../../lib/api'
import { formatPct, formatZAR, labelize } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, PageHeader, ProgressBar, Spinner, StatusBadge } from '../../../components/ui'
import { PROJECT_STATUSES, type ProjectStatus } from '../../../types'
import { paths } from '../paths'
import { ProjectFormModal } from './ProjectFormModal'

export function ProjectsList() {
  const [status, setStatus] = useState<ProjectStatus | 'all' | 'open'>('open')
  const [creating, setCreating] = useState(false)
  const { data, error, loading, reload } = useLoad(async () => {
    const [list, fin, dir] = await Promise.all([projectsApi.list(), listProjectFinancials(), loadClientDirectory()])
    return { list, fin, dir }
  })

  const rows = useMemo(() => {
    if (!data) return []
    return data.list.filter((p) =>
      status === 'all' ? true : status === 'open' ? !['completed', 'cancelled'].includes(p.status) : p.status === status,
    )
  }, [data, status])

  return (
    <div>
      <PageHeader title="Projects" actions={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New project</Button>} />
      <ErrorBanner error={error} />
      <div className="mb-3 flex flex-wrap gap-1">
        {(['open', 'all', ...PROJECT_STATUSES] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-xs font-medium ${status === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {s === 'open' ? 'Open' : s === 'all' ? 'All' : labelize(s)}
          </button>
        ))}
      </div>
      {loading && !data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card><EmptyState title="No projects" icon={<FolderKanban size={32} />}>Create one, or convert an accepted quote.</EmptyState></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const f = data!.fin.get(p.id)
            return (
              <Link key={p.id} to={paths.project(p.id)} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-amber-300 hover:shadow">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{p.name}</p>
                    <p className="truncate text-xs text-slate-500">{p.code ? `${p.code} · ` : ''}{clientLabel(data!.dir, p)}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="tabular mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><p className="text-slate-500">Contract</p><p className="font-medium text-slate-800">{formatZAR(f?.revised_contract ?? p.contract_value, { decimals: 0 })}</p></div>
                  <div><p className="text-slate-500">Spent</p><p className="font-medium text-slate-800">{formatZAR(f?.expenses_total ?? 0, { decimals: 0 })}</p></div>
                  <div><p className="text-slate-500">Profit</p><p className={`font-medium ${(f?.gross_profit ?? 0) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatZAR(f?.gross_profit ?? 0, { decimals: 0 })}</p></div>
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[11px] text-slate-500"><span>Budget used</span><span>{p.budget ? formatPct(((f?.expenses_total ?? 0) / p.budget) * 100, 0) : '—'} · margin {formatPct(f?.margin_pct)}</span></div>
                  <ProgressBar value={f?.expenses_total ?? 0} max={p.budget} />
                </div>
              </Link>
            )
          })}
        </div>
      )}
      <ProjectFormModal open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />
    </div>
  )
}
