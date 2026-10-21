import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Plus, Search } from 'lucide-react'
import { clientLabel, listQuoteTotals, loadClientDirectory, quotes as quotesApi } from '../../../lib/api'
import { formatDate, formatZAR, labelize } from '../../../lib/format'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatusBadge, Table, td, th } from '../../../components/ui'
import { QUOTE_STATUSES, type QuoteStatus } from '../../../types'
import { paths } from '../paths'
import { useBuild } from '../BuildContext'

export function QuotesList() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { settings } = useBuild()
  const [status, setStatus] = useState<QuoteStatus | 'all'>('all')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const { data, error, loading } = useLoad(async () => {
    const [list, totals, dir] = await Promise.all([quotesApi.list(), listQuoteTotals(), loadClientDirectory()])
    return { list, totals, dir }
  })

  async function createQuote() {
    setCreating(true)
    setCreateError(null)
    try {
      const validUntil = new Date()
      validUntil.setDate(validUntil.getDate() + 30)
      const quote = await quotesApi.create({
        title: 'New quote',
        status: 'draft',
        vat_rate: settings?.vat_rate ?? 15,
        terms: settings?.quote_terms ?? null,
        valid_until: validUntil.toISOString().slice(0, 10),
      })
      navigate(paths.quote(quote.id))
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e))
      setCreating(false)
    }
  }

  // Dashboard "New quote" lands here with ?new=1.
  useEffect(() => {
    if (params.get('new') === '1') {
      setParams({}, { replace: true })
      void createQuote()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return data.list
      .filter((x) => status === 'all' || x.status === status)
      .filter((x) => !needle || `${x.number} ${x.title} ${clientLabel(data.dir, x)} ${x.site_address ?? ''}`.toLowerCase().includes(needle))
  }, [data, status, q])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.list.length ?? 0 }
    data?.list.forEach((x) => (c[x.status] = (c[x.status] ?? 0) + 1))
    return c
  }, [data])

  return (
    <div>
      <PageHeader
        title="Quotes"
        actions={
          <Button variant="primary" onClick={createQuote} loading={creating}>
            <Plus size={16} /> New quote
          </Button>
        }
      />
      <ErrorBanner error={error ?? createError} />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {(['all', ...QUOTE_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${status === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}
            >
              {s === 'all' ? 'All' : labelize(s)} {counts[s] ? <span className="opacity-60">{counts[s]}</span> : null}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search quotes" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card padded={false}>
        {loading && !data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState title="No quotes" icon={<FileText size={32} />}>Create a quote to price up a job.</EmptyState>
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {rows.map((x) => (
                <li key={x.id}>
                  <Link to={paths.quote(x.id)} className="block px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">{x.title || 'Untitled'}</span>
                      <StatusBadge status={x.status} />
                    </div>
                    <div className="mt-0.5 flex justify-between text-xs text-slate-500">
                      <span>{x.number} · {clientLabel(data!.dir, x)}</span>
                      <span className="tabular font-medium text-slate-700">{formatZAR(data!.totals.get(x.id)?.total_incl ?? 0)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Number</th>
                    <th className={th}>Title</th>
                    <th className={th}>Client</th>
                    <th className={th}>Issued</th>
                    <th className={`${th} text-right`}>Total incl. VAT</th>
                    <th className={`${th} text-right`}>Est. margin</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => {
                    const t = data!.totals.get(x.id)
                    const margin = t ? t.total_excl - t.estimated_cost : 0
                    return (
                      <tr key={x.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(paths.quote(x.id))}>
                        <td className={`${td} font-mono text-xs text-slate-500`}>{x.number}</td>
                        <td className={`${td} font-medium text-slate-900`}>{x.title || 'Untitled'}</td>
                        <td className={td}>{clientLabel(data!.dir, x)}</td>
                        <td className={td}>{formatDate(x.issue_date)}</td>
                        <td className={`${td} tabular text-right`}>{formatZAR(t?.total_incl ?? 0)}</td>
                        <td className={`${td} tabular text-right ${margin < 0 ? 'text-red-600' : 'text-slate-600'}`}>
                          {t && t.total_excl ? `${((margin / t.total_excl) * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className={td}><StatusBadge status={x.status} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
