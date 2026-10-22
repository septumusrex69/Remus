import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Download, Plus } from 'lucide-react'
import { expenses as expensesApi, listExpensesBetween, listLinkedExpenseIds, projects as projectsApi } from '../../../lib/api'
import { formatZAR, labelize } from '../../../lib/format'
import { exportExpensesCsv } from '../../../lib/csvExport'
import { PERIOD_LABELS, periodRange, type PeriodKey } from '../../../lib/period'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, ErrorBanner, PageHeader, Spinner, StatTile } from '../../../components/ui'
import { EXPENSE_CATEGORIES, type Expense } from '../../../types'
import { ExpenseFormModal } from '../components/ExpenseFormModal'
import { ExpenseTable } from '../components/ExpenseTable'
import { paths } from '../paths'

export function ExpensesPage() {
  const [period, setPeriod] = useState<PeriodKey>('this_month')
  const [project, setProject] = useState<string>('all')
  const [category, setCategory] = useState<string>('all')
  const [link, setLink] = useState<'all' | 'linked' | 'unlinked'>('all')
  const [editing, setEditing] = useState<Expense | null>(null)
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const range = periodRange(period)
  const { data, error, loading, reload } = useLoad(async () => {
    const [rows, projects, linked] = await Promise.all([listExpensesBetween(range.from, range.to), projectsApi.list(), listLinkedExpenseIds()])
    return { rows, projects, linked }
  }, [range.from, range.to], 'expenses')

  const rows = useMemo(() => {
    if (!data) return []
    return data.rows.filter(
      (e) =>
        (project === 'all' || (project === 'overhead' ? !e.project_id : e.project_id === project)) &&
        (category === 'all' || e.category === category) &&
        (link === 'all' || (link === 'linked') === data.linked.has(e.id)),
    )
  }, [data, project, category, link])

  const totalExcl = rows.reduce((s, e) => s + e.amount_excl, 0)
  const totalVat = rows.reduce((s, e) => s + e.vat, 0)

  return (
    <div>
      <PageHeader
        title="Expenses"
        actions={
          <>
            <Link to={paths.capture()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600"><Camera size={16} /> Snap slip</Link>
            <Button onClick={() => setAdding(true)}><Plus size={16} /> Add</Button>
            <Button onClick={() => data && exportExpensesCsv(rows, data.projects, data.linked, `expenses-${range.from}-to-${range.to}.csv`)} disabled={!rows.length}><Download size={16} /> CSV</Button>
          </>
        }
      />
      <ErrorBanner error={actionError ?? error} />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <select className="input sm:w-auto" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).filter((k) => k !== 'custom').map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
        </select>
        <select className="input sm:w-auto" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="all">All projects</option>
          <option value="overhead">Overheads only</option>
          {data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input sm:w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
        </select>
        <select className="input sm:w-auto" value={link} onChange={(e) => setLink(e.target.value as typeof link)}>
          <option value="all">Linked & unlinked</option>
          <option value="linked">On bank statement</option>
          <option value="unlinked">Not on statement yet</option>
        </select>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <StatTile label="Excl. VAT" value={formatZAR(totalExcl, { decimals: 0 })} />
        <StatTile label="VAT" value={formatZAR(totalVat, { decimals: 0 })} />
        <StatTile label="Count" value={rows.length} />
      </div>
      <Card padded={false}>
        {loading && !data ? <Spinner /> : (
          <ExpenseTable
            rows={rows}
            projects={data?.projects ?? []}
            linked={data?.linked ?? new Set()}
            onEdit={setEditing}
            onDelete={async (e) => {
              if (!window.confirm('Delete this expense?')) return
              setActionError(null)
              try {
                await expensesApi.remove(e.id)
                reload()
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err))
              }
            }}
          />
        )}
      </Card>
      <ExpenseFormModal
        open={adding || !!editing}
        editing={editing}
        projects={data?.projects ?? []}
        onClose={() => { setAdding(false); setEditing(null) }}
        onSaved={() => { setAdding(false); setEditing(null); reload() }}
      />
    </div>
  )
}
