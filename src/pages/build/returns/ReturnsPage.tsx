import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, FileText, Plus, Receipt, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorBanner, Modal, PageHeader, Spinner, StatTile, Tabs } from '../../../components/ui'
import { listRecentExpenses, projects as projectsApi, reopenReturn, signedUrls, slipReturns } from '../../../lib/api'
import { formatDate, formatZAR } from '../../../lib/format'
import { refreshReturnCount } from '../../../lib/returnCount'
import { itemsLabel, openSummary, RETURN_STATUS_LABEL, type ReturnStatus, type SlipReturn } from '../../../lib/slipReturns'
import { RECEIPTS_BUCKET } from '../../../lib/supabase'
import { useLoad } from '../../../hooks/useLoad'
import type { Expense } from '../../../types'
import { ReturnFormModal, ReturnedModal } from './ReturnModals'

/**
 * RETURNS (Remus · Handover 8, 2 Nov 2026). Stephan: "you've bought ten paint strippers and you only used 5. Then
 * the other 5 should be returned." The list of goods waiting to go back to the stores, and what came back.
 * Logged from a slip (Expenses, or "+ New return" here); closed with the credit note, which takes the money off
 * the job. For the people who snap slips; a site manager sees the ones they logged.
 */
export function ReturnsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as ReturnStatus | null) ?? 'to_return'
  const setTab = (t: ReturnStatus) => setParams(t === 'to_return' ? {} : { tab: t }, { replace: true })
  const { data, error, loading, reload } = useLoad(async () => {
    const [rows, projects] = await Promise.all([slipReturns.list(), projectsApi.list()])
    return { rows, projects }
  }, [], 'slip-returns')
  const [picking, setPicking] = useState(false)
  const [logging, setLogging] = useState<{ slip: Expense | null } | null>(null)
  const [closing, setClosing] = useState<SlipReturn | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const rows = useMemo(() => (data?.rows ?? []).filter((r) => r.status === tab), [data, tab])
  const counts = useMemo(() => {
    const c: Record<ReturnStatus, number> = { to_return: 0, returned: 0, cancelled: 0 }
    for (const r of data?.rows ?? []) c[r.status]++
    return c
  }, [data])
  const open = openSummary(data?.rows ?? [])
  const back = (data?.rows ?? []).filter((r) => r.status === 'returned').reduce((t, r) => t + (r.credit_amount_incl ?? 0), 0)
  const projectName = new Map((data?.projects ?? []).map((p) => [p.id, p.name]))

  // The credit notes' photos, for the Returned list.
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const photoKey = rows.map((r) => r.credit_path ?? '').join('|')
  useEffect(() => {
    const ps = rows.map((r) => r.credit_path).filter((p): p is string => !!p)
    if (ps.length) signedUrls(RECEIPTS_BUCKET, ps).then(setUrls).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey])

  async function act(r: SlipReturn, fn: () => Promise<unknown>) {
    setBusy(r.id)
    setActionError(null)
    try {
      await fn()
      void refreshReturnCount()
      reload()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Returns"
        subtitle="Goods going back to the store, and what came back."
        actions={<Button variant="primary" onClick={() => setPicking(true)} data-testid="return-new"><Plus size={16} /> New return</Button>}
      />
      <ErrorBanner error={actionError ?? error} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <StatTile label="To take back" value={`${open.count} · ${formatZAR(open.amount, { decimals: 0 })}`} hint="Still at the site or in the bakkie" />
        <StatTile label="Credited" value={formatZAR(back, { decimals: 0 })} hint="Taken off the jobs" />
      </div>
      <Tabs<ReturnStatus>
        value={tab}
        onChange={setTab}
        tabs={(['to_return', 'returned', 'cancelled'] as ReturnStatus[]).map((s) => ({ id: s, label: `${RETURN_STATUS_LABEL[s]}${counts[s] ? ` (${counts[s]})` : ''}` }))}
      />
      <Card padded={false}>
        {loading && !data ? <Spinner /> : rows.length === 0 ? (
          <EmptyState title={tab === 'to_return' ? 'Nothing waiting to go back' : 'None yet'} icon={<RotateCcw size={28} />}>
            {tab === 'to_return' ? 'Bought too much? Open the slip and choose "Return items", or tap New return.' : null}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="return-list">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3" data-testid="return-row">
                {/* On a phone the words take the row and the amount and buttons drop under them. */}
                <div className="min-w-[16rem] flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {r.supplier || 'Store'}
                    {r.receipt_number ? <span className="font-normal text-slate-500"> · slip {r.receipt_number}</span> : null}
                  </p>
                  <p className="text-sm text-slate-700">{itemsLabel(r.items) || '—'}</p>
                  <p className="text-xs text-slate-500">
                    {r.project_id ? projectName.get(r.project_id) ?? 'Project' : 'Overheads'}
                    {r.bought_on ? ` · bought ${formatDate(r.bought_on)}` : ''}
                    {r.returned_on ? ` · returned ${formatDate(r.returned_on)}` : ''}
                    {r.credit_number ? ` · credit note ${r.credit_number}` : ''}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <span className="tabular ml-auto shrink-0 text-right text-sm">
                  {r.status === 'returned' ? (
                    <>
                      <span className="font-medium text-emerald-700">{formatZAR(r.credit_amount_incl ?? 0)}</span>
                      {r.credit_amount_incl != null && Math.abs(r.credit_amount_incl - r.amount_incl) > 0.009 && (
                        <span className="block text-[11px] text-slate-500">expected {formatZAR(r.amount_incl)}</span>
                      )}
                    </>
                  ) : <span className="font-medium text-slate-900">{formatZAR(r.amount_incl)}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {r.status === 'to_return' && <>
                    <Button size="sm" variant="primary" onClick={() => setClosing(r)} data-testid="return-done"><CheckCircle2 size={14} /> Returned</Button>
                    <Button size="sm" variant="ghost" loading={busy === r.id} title="We kept them after all"
                      onClick={() => act(r, () => slipReturns.update(r.id, { status: 'cancelled', updated_at: new Date().toISOString() }))}>Kept</Button>
                  </>}
                  {r.status === 'returned' && <>
                    {r.credit_path && urls.get(r.credit_path) && (
                      <a href={urls.get(r.credit_path)} target="_blank" rel="noreferrer" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Credit note" aria-label="Credit note"><FileText size={15} /></a>
                    )}
                    <Badge tone="bg-emerald-50 text-emerald-700">Credited</Badge>
                    <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Undo: take the credit off again" aria-label="Undo returned"
                      onClick={() => window.confirm('Undo "Returned"? The credit comes off the job again and it goes back on the list.') && act(r, () => reopenReturn(r))}><Undo2 size={14} /></button>
                  </>}
                  {r.status === 'cancelled' && (
                    <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Back on the list" aria-label="Back on the list"
                      onClick={() => act(r, () => slipReturns.update(r.id, { status: 'to_return', updated_at: new Date().toISOString() }))}><Undo2 size={14} /></button>
                  )}
                  {r.status !== 'returned' && (
                    <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete"
                      onClick={() => window.confirm('Delete this return?') && act(r, () => slipReturns.remove(r.id))}><Trash2 size={14} /></button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SlipPicker open={picking} onClose={() => setPicking(false)} onPick={(slip) => { setPicking(false); setLogging({ slip }) }} />
      <ReturnFormModal open={!!logging} slip={logging?.slip ?? null} projects={data?.projects ?? []}
        onClose={() => setLogging(null)} onSaved={() => { setLogging(null); setTab('to_return'); reload() }} />
      <ReturnedModal ret={closing} onClose={() => setClosing(null)} onSaved={() => { setClosing(null); reload() }} />
    </div>
  )
}

/** "+ New return": which slip did the goods come on? The latest slips, or none (typed by hand). */
function SlipPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (slip: Expense | null) => void }) {
  const [slips, setSlips] = useState<Expense[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!open) return
    setQ('')
    setSlips(null)
    listRecentExpenses(60).then((rows) => setSlips(rows.filter((e) => e.amount_excl + e.vat > 0 && (e.source === 'receipt' || e.receipt_path)))).catch(() => setSlips([]))
  }, [open])
  const shown = (slips ?? []).filter((e) => !q.trim() || `${e.supplier ?? ''} ${e.description ?? ''} ${e.receipt_number ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Modal open={open} onClose={onClose} title="Which slip were they bought on?">
      <input className="input mb-3" placeholder="Search store, item or slip number" value={q} onChange={(e) => setQ(e.target.value)} />
      {slips === null ? <Spinner /> : (
        <ul className="max-h-[50dvh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200" data-testid="slip-picker">
          {shown.map((e) => (
            <li key={e.id}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50" onClick={() => onPick(e)}>
                <Receipt size={16} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{e.supplier || e.description || 'Slip'}</span>
                  <span className="block truncate text-xs text-slate-500">{formatDate(e.date)}{e.receipt_number ? ` · no. ${e.receipt_number}` : ''}{e.description && e.supplier ? ` · ${e.description}` : ''}</span>
                </span>
                <span className="tabular shrink-0 text-sm text-slate-700">{formatZAR(e.amount_excl + e.vat)}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No slips found.</li>}
        </ul>
      )}
      <Button variant="ghost" className="mt-3" onClick={() => onPick(null)}>The slip isn't in Remus: type it in</Button>
    </Modal>
  )
}
