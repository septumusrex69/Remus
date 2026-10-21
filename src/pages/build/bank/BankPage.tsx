import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Ban, Check, FileUp, Link2, Plus, RefreshCw, Search, Sparkles, Undo2 } from 'lucide-react'
import {
  bankAccounts,
  bankTransactions,
  clientLabel,
  expenses as expensesApi,
  invoices as invoicesApi,
  listBankTransactions,
  loadClientDirectory,
  payments as paymentsApi,
  projects as projectsApi,
} from '../../../lib/api'
import { formatDate, formatZAR, labelize, round2 } from '../../../lib/format'
import { splitInclusive } from '../../../lib/quoteMath'
import { reconcile, type Candidate } from '../../../lib/reconcile'
import { useLoad } from '../../../hooks/useLoad'
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, Tabs } from '../../../components/ui'
import { BANKS, type Bank, type BankAccount, type BankTransaction, type Expense } from '../../../types'
import { ExpenseFormModal, type ExpenseDraft } from '../components/ExpenseFormModal'
import { useBuild, useVatRate } from '../BuildContext'
import { ImportStatementModal } from './ImportStatementModal'

type Tab = 'needs' | 'matched' | 'ignored' | 'slips'

const IGNORE_REASONS = ['Transfer between own accounts', 'Personal', 'Bank fees (no slip)', 'Loan / drawings', 'Duplicate', 'Other']

async function load() {
  const [accounts, txs, expenses, payments, invoices, projects, dir] = await Promise.all([
    bankAccounts.list(),
    listBankTransactions(),
    expensesApi.list(),
    paymentsApi.list(),
    invoicesApi.list(),
    projectsApi.list(),
    loadClientDirectory(),
  ])
  return { accounts, txs, expenses, payments, invoices, projects, dir }
}

export function BankPage() {
  const vatRate = useVatRate()
  const { refreshNeedsLinking } = useBuild()
  const { data, error, loading, reload } = useLoad(load)
  const [tab, setTab] = useState<Tab>('needs')
  const [accountId, setAccountId] = useState<string>('all')
  const [importOpen, setImportOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [linkFor, setLinkFor] = useState<BankTransaction | null>(null)
  const [createFor, setCreateFor] = useState<BankTransaction | null>(null)
  const [ignoreFor, setIgnoreFor] = useState<BankTransaction | null>(null)

  const linkedExpenseIds = useMemo(() => new Set((data?.txs ?? []).filter((t) => t.status === 'matched' && t.matched_expense_id).map((t) => t.matched_expense_id!)), [data])
  const linkedPaymentIds = useMemo(() => new Set((data?.txs ?? []).filter((t) => t.status === 'matched' && t.matched_payment_id).map((t) => t.matched_payment_id!)), [data])

  // Live candidates for every open transaction (cheap: pure, in-memory).
  const decisions = useMemo(() => {
    if (!data) return new Map<string, Candidate[]>()
    const open = data.txs.filter((t) => t.status === 'unmatched' || t.status === 'suggested')
    const ds = reconcile({
      transactions: open,
      expenses: data.expenses,
      payments: data.payments,
      invoices: data.invoices.map((i) => ({ ...i, client_name: clientLabel(data.dir, i) })),
      linkedExpenseIds,
      linkedPaymentIds,
    })
    return new Map(ds.map((d) => [d.transactionId, d.candidates]))
  }, [data, linkedExpenseIds, linkedPaymentIds])

  if (loading && !data) return <Spinner />
  if (!data) return <ErrorBanner error={error} />

  const inAccount = (t: BankTransaction) => accountId === 'all' || t.bank_account_id === accountId
  const needs = data.txs.filter((t) => inAccount(t) && (t.status === 'unmatched' || t.status === 'suggested'))
  const matched = data.txs.filter((t) => inAccount(t) && t.status === 'matched')
  const ignored = data.txs.filter((t) => inAccount(t) && t.status === 'ignored')
  const slipsNotOnStatement = data.expenses.filter((e) => e.paid && !linkedExpenseIds.has(e.id))
  const expenseById = new Map(data.expenses.map((e) => [e.id, e]))
  const paymentById = new Map(data.payments.map((p) => [p.id, p]))
  const invoiceById = new Map(data.invoices.map((i) => [i.id, i]))
  const projectName = (id: string | null) => (id ? data.projects.find((p) => p.id === id)?.name ?? 'Project' : 'Overhead')
  const selectedAccount = accountId === 'all' ? data.accounts[0] ?? null : data.accounts.find((a) => a.id === accountId) ?? null

  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id)
    setActionError(null)
    try {
      await fn()
      reload()
      refreshNeedsLinking()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const linkExpense = (t: BankTransaction, expenseId: string, score: number | null = null) =>
    bankTransactions.update(t.id, { status: 'matched', matched_expense_id: expenseId, matched_payment_id: null, match_score: score, ignore_reason: null }).then(() => {})

  async function confirm(t: BankTransaction, c: Candidate) {
    if (c.kind === 'expense') return linkExpense(t, c.id, c.score)
    if (c.kind === 'payment') {
      await bankTransactions.update(t.id, { status: 'matched', matched_payment_id: c.id, matched_expense_id: null, match_score: c.score })
      return
    }
    // Invoice: record the payment it represents, then link to that.
    const inv = invoiceById.get(c.id)!
    const pay = await paymentsApi.create({ invoice_id: inv.id, project_id: inv.project_id, date: t.date, amount: t.amount, method: 'eft', reference: t.reference || t.description.slice(0, 80) })
    const paidSoFar = data!.payments.filter((p) => p.invoice_id === inv.id).reduce((s, p) => s + p.amount, 0) + t.amount
    if (paidSoFar >= inv.amount_excl + inv.vat - 0.005) await invoicesApi.update(inv.id, { status: 'paid' })
    await bankTransactions.update(t.id, { status: 'matched', matched_payment_id: pay.id, matched_expense_id: null, match_score: c.score })
  }

  /** Re-runs the engine and writes auto-matches/suggestions back. */
  async function rerun() {
    const open = data!.txs.filter((t) => t.status === 'unmatched' || t.status === 'suggested')
    const ds = reconcile({
      transactions: open,
      expenses: data!.expenses,
      payments: data!.payments,
      invoices: [], // invoice matches create payments, so they are only ever confirmed by a person
      linkedExpenseIds,
      linkedPaymentIds,
    })
    let auto = 0
    for (const d of ds) {
      const t = open.find((x) => x.id === d.transactionId)!
      if (d.status === 'matched' && d.best) {
        auto++
        await bankTransactions.update(t.id, {
          status: 'matched',
          matched_expense_id: d.best.kind === 'expense' ? d.best.id : null,
          matched_payment_id: d.best.kind === 'payment' ? d.best.id : null,
          match_score: d.best.score,
        })
      } else if (d.status !== t.status) {
        await bankTransactions.update(t.id, { status: d.status, match_score: d.best?.score ?? null })
      }
    }
    setNotice(`Matching done: ${auto} auto-matched.`)
  }

  const describeCandidate = (c: Candidate) => {
    if (c.kind === 'expense') {
      const e = expenseById.get(c.id)
      return e ? `${e.supplier || e.description || 'Expense'} · ${formatDate(e.date)} · ${projectName(e.project_id)}` : 'Expense'
    }
    if (c.kind === 'payment') {
      const p = paymentById.get(c.id)
      return p ? `Payment ${formatDate(p.date)} ${p.reference ?? ''}` : 'Payment'
    }
    const i = invoiceById.get(c.id)
    return i ? `Invoice ${i.number} · ${clientLabel(data.dir, i)} (records a payment)` : 'Invoice'
  }

  const txRow = (t: BankTransaction, actions: ReactNode, extra?: ReactNode) => (
    <li key={t.id} className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${t.amount < 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
          {t.amount < 0 ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="truncate text-sm font-medium text-slate-800">{t.description || '(no description)'}</p>
            <p className={`tabular text-sm font-semibold ${t.amount < 0 ? 'text-slate-900' : 'text-emerald-700'}`}>{formatZAR(t.amount)}</p>
          </div>
          <p className="text-xs text-slate-500">
            {formatDate(t.date)}
            {t.reference ? ` · ref ${t.reference}` : ''}
            {accountId === 'all' && data.accounts.length > 1 ? ` · ${data.accounts.find((a) => a.id === t.bank_account_id)?.name ?? ''}` : ''}
          </p>
          {extra}
          <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>
        </div>
      </div>
    </li>
  )

  return (
    <div>
      <PageHeader
        title="Bank"
        subtitle="Link every bank line to a slip, expense or client payment."
        actions={
          <>
            <Button onClick={() => act('rerun', rerun)} loading={busy === 'rerun'}><RefreshCw size={15} /> Re-run matching</Button>
            <Button variant="primary" onClick={() => (data.accounts.length ? setImportOpen(true) : setAccountOpen(true))}><FileUp size={15} /> Import statement</Button>
          </>
        }
      />
      <ErrorBanner error={error ?? actionError} />
      {notice && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="all">All accounts</option>
          {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.account_number_last4 ? ` ··${a.account_number_last4}` : ''}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={() => setAccountOpen(true)}><Plus size={13} /> Account</Button>
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'needs', label: <>Needs linking {needs.length > 0 && <Badge tone="bg-amber-100 text-amber-800" className="ml-1">{needs.length}</Badge>}</> },
          { id: 'matched', label: `Matched (${matched.length})` },
          { id: 'ignored', label: `Ignored (${ignored.length})` },
          { id: 'slips', label: `Slips not on statement (${slipsNotOnStatement.length})` },
        ]}
      />

      {data.accounts.length === 0 ? (
        <Card><EmptyState title="No bank accounts yet">Add your business account, then import a CSV statement export from internet banking.<div className="mt-3"><Button variant="primary" onClick={() => setAccountOpen(true)}><Plus size={14} /> Add bank account</Button></div></EmptyState></Card>
      ) : tab === 'needs' ? (
        <Card padded={false}>
          {needs.length === 0 ? <EmptyState title="All caught up" icon={<Check size={28} />}>Every imported bank line is linked or ignored.</EmptyState> : (
            <ul className="divide-y divide-slate-100">
              {needs.map((t) => {
                const cands = decisions.get(t.id) ?? []
                const best = cands[0]
                return txRow(
                  t,
                  <>
                    {best && best.score >= 50 && (
                      <Button size="sm" variant="primary" onClick={() => act(t.id, () => confirm(t, best))} loading={busy === t.id}><Check size={13} /> Confirm match</Button>
                    )}
                    {t.amount < 0 ? (
                      <>
                        <Button size="sm" onClick={() => setLinkFor(t)}><Link2 size={13} /> Link to expense</Button>
                        <Button size="sm" onClick={() => setCreateFor(t)}><Plus size={13} /> Create expense</Button>
                      </>
                    ) : (
                      <Button size="sm" onClick={() => setLinkFor(t)}><Link2 size={13} /> Link payment / invoice</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setIgnoreFor(t)}><Ban size={13} /> Ignore</Button>
                  </>,
                  best ? (
                    <div className={`mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${best.score >= 50 ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-600'}`}>
                      <Sparkles size={13} className="mt-0.5 shrink-0" />
                      <span>
                        <strong>{best.score >= 50 ? 'Likely' : 'Possible'}:</strong> {describeCandidate(best)} <span className="opacity-70">({best.score}% · {best.reasons.join(', ')})</span>
                        {cands.length > 1 && <span className="opacity-70"> · {cands.length - 1} other candidate{cands.length > 2 ? 's' : ''}</span>}
                      </span>
                    </div>
                  ) : undefined,
                )
              })}
            </ul>
          )}
        </Card>
      ) : tab === 'matched' ? (
        <Card padded={false}>
          {matched.length === 0 ? <EmptyState title="Nothing matched yet" /> : (
            <ul className="divide-y divide-slate-100">
              {matched.map((t) => {
                const e = t.matched_expense_id ? expenseById.get(t.matched_expense_id) : null
                const p = t.matched_payment_id ? paymentById.get(t.matched_payment_id) : null
                return txRow(
                  t,
                  <Button size="sm" variant="ghost" onClick={() => act(t.id, () => bankTransactions.update(t.id, { status: 'unmatched', matched_expense_id: null, matched_payment_id: null, match_score: null }).then(() => {}))}><Undo2 size={13} /> Unlink</Button>,
                  <p className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
                    <Link2 size={12} />
                    {e ? `${e.supplier || e.description || labelize(e.category)} · ${projectName(e.project_id)}` : p ? `Payment ${formatDate(p.date)}${p.invoice_id ? ` · ${invoiceById.get(p.invoice_id)?.number ?? ''}` : ''}` : 'Linked'}
                  </p>,
                )
              })}
            </ul>
          )}
        </Card>
      ) : tab === 'ignored' ? (
        <Card padded={false}>
          {ignored.length === 0 ? <EmptyState title="Nothing ignored" /> : (
            <ul className="divide-y divide-slate-100">
              {ignored.map((t) =>
                txRow(
                  t,
                  <Button size="sm" variant="ghost" onClick={() => act(t.id, () => bankTransactions.update(t.id, { status: 'unmatched', ignore_reason: null }).then(() => {}))}><Undo2 size={13} /> Restore</Button>,
                  <p className="mt-1 text-xs text-slate-500">Ignored: {t.ignore_reason}</p>,
                ),
              )}
            </ul>
          )}
        </Card>
      ) : (
        <Card padded={false}>
          <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">Paid expenses and slips that no bank line has been linked to yet — usually because the statement covering them hasn't been imported, or they were paid in cash.</p>
          {slipsNotOnStatement.length === 0 ? <EmptyState title="Every paid expense is on a statement" /> : (
            <ul className="divide-y divide-slate-100">
              {slipsNotOnStatement.slice(0, 200).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0"><span className="block truncate font-medium text-slate-800">{e.supplier || e.description || labelize(e.category)}</span><span className="block text-xs text-slate-500">{formatDate(e.date)} · {projectName(e.project_id)} · {e.source === 'receipt' ? 'slip' : e.source}</span></span>
                  <span className="tabular font-medium">{formatZAR(e.amount_excl + e.vat)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ImportStatementModal
        open={importOpen}
        account={selectedAccount}
        onClose={() => setImportOpen(false)}
        onImported={async (inserted, summary) => {
          setImportOpen(false)
          setNotice(summary)
          // Run matching over the fresh lines straight away.
          const ds = reconcile({ transactions: inserted, expenses: data.expenses, payments: data.payments, invoices: [], linkedExpenseIds, linkedPaymentIds })
          let auto = 0
          for (const d of ds) {
            if (d.status === 'unmatched') continue
            if (d.status === 'matched') auto++
            await bankTransactions.update(d.transactionId, {
              status: d.status,
              matched_expense_id: d.status === 'matched' && d.best?.kind === 'expense' ? d.best.id : null,
              matched_payment_id: d.status === 'matched' && d.best?.kind === 'payment' ? d.best.id : null,
              match_score: d.best?.score ?? null,
            }).catch(() => {})
          }
          if (auto) setNotice(`${summary} ${auto} matched automatically.`)
          reload()
          refreshNeedsLinking()
        }}
      />

      <LinkModal
        tx={linkFor}
        onClose={() => setLinkFor(null)}
        expenses={data.expenses.filter((e) => !linkedExpenseIds.has(e.id))}
        payments={data.payments.filter((p) => !linkedPaymentIds.has(p.id))}
        invoices={data.invoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled')}
        describe={describeCandidate}
        projectName={projectName}
        onPick={(c) => {
          const t = linkFor!
          setLinkFor(null)
          void act(t.id, () => confirm(t, { ...c, score: c.score }))
        }}
        onRecordPayment={(t) => {
          setLinkFor(null)
          void act(t.id, async () => {
            const pay = await paymentsApi.create({ date: t.date, amount: t.amount, method: 'eft', reference: t.reference || t.description.slice(0, 80) })
            await bankTransactions.update(t.id, { status: 'matched', matched_payment_id: pay.id, matched_expense_id: null })
          })
        }}
      />

      <ExpenseFormModal
        open={!!createFor}
        projects={data.projects}
        initial={createFor ? createDraft(createFor, vatRate) : undefined}
        onClose={() => setCreateFor(null)}
        onSaved={(e: Expense) => {
          const t = createFor!
          setCreateFor(null)
          void act(t.id, () => linkExpense(t, e.id, 100))
        }}
      />

      <IgnoreModal
        tx={ignoreFor}
        onClose={() => setIgnoreFor(null)}
        onIgnore={(reason) => {
          const t = ignoreFor!
          setIgnoreFor(null)
          void act(t.id, () => bankTransactions.update(t.id, { status: 'ignored', ignore_reason: reason, matched_expense_id: null, matched_payment_id: null }).then(() => {}))
        }}
      />

      <AccountModal open={accountOpen} onClose={() => setAccountOpen(false)} onSaved={(a) => { setAccountOpen(false); setAccountId(a.id); reload() }} />
    </div>
  )
}

function createDraft(t: BankTransaction, vatRate: number): ExpenseDraft {
  const total = Math.abs(t.amount)
  const s = splitInclusive(total, vatRate)
  // Bank descriptions are shouty and padded with card noise; keep the readable part as supplier.
  const supplier = t.description.replace(/\b(POS|PURCHASE|CARD|DEBIT ORDER|EFT|PMT)\b/gi, '').replace(/\d{4,}/g, '').replace(/\s+/g, ' ').trim()
  return { date: t.date, supplier: supplier.slice(0, 60), description: t.description, amount_excl: s.excl, vat: s.vat, category: 'materials', paid: true, source: 'bank' }
}

function LinkModal({
  tx,
  onClose,
  expenses,
  payments,
  invoices,
  describe,
  projectName,
  onPick,
  onRecordPayment,
}: {
  tx: BankTransaction | null
  onClose: () => void
  expenses: Expense[]
  payments: { id: string; date: string; amount: number; reference: string | null }[]
  invoices: { id: string; number: string | null; amount_excl: number; vat: number }[]
  describe: (c: Candidate) => string
  projectName: (id: string | null) => string
  onPick: (c: Candidate) => void
  onRecordPayment: (t: BankTransaction) => void
}) {
  const [q, setQ] = useState('')
  const [sameAmount, setSameAmount] = useState(true)
  if (!tx) return null
  const amt = Math.abs(tx.amount)
  const needle = q.trim().toLowerCase()
  const close = (n: number) => Math.abs(round2(n) - round2(amt)) < 0.005

  const items: { c: Candidate; label: string; amount: number }[] =
    tx.amount < 0
      ? expenses
          .filter((e) => (!sameAmount || close(e.amount_excl + e.vat)) && (!needle || `${e.supplier} ${e.description}`.toLowerCase().includes(needle)))
          .slice(0, 50)
          .map((e) => ({ c: { kind: 'expense', id: e.id, score: 0, reasons: ['Linked by hand'] }, label: `${e.supplier || e.description || 'Expense'} · ${formatDate(e.date)} · ${projectName(e.project_id)}`, amount: e.amount_excl + e.vat }))
      : [
          ...payments.filter((p) => !sameAmount || close(p.amount)).map((p) => ({ c: { kind: 'payment' as const, id: p.id, score: 0, reasons: [] }, label: describe({ kind: 'payment', id: p.id, score: 0, reasons: [] }), amount: p.amount })),
          ...invoices.filter((i) => !sameAmount || close(i.amount_excl + i.vat)).map((i) => ({ c: { kind: 'invoice' as const, id: i.id, score: 0, reasons: [] }, label: describe({ kind: 'invoice', id: i.id, score: 0, reasons: [] }), amount: i.amount_excl + i.vat })),
        ].filter((x) => !needle || x.label.toLowerCase().includes(needle))

  return (
    <Modal open onClose={onClose} title={`Link ${formatZAR(tx.amount)} · ${formatDate(tx.date)}`} wide>
      <p className="mb-3 text-sm text-slate-600">{tx.description}</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={sameAmount} onChange={(e) => setSameAmount(e.target.checked)} /> Same amount only</label>
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nothing found.{sameAmount ? ' Try unticking "Same amount only".' : ''}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {items.map((x) => (
            <li key={`${x.c.kind}:${x.c.id}`}>
              <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-amber-50" onClick={() => onPick(x.c)}>
                <span className="min-w-0 truncate">{x.label}</span>
                <span className="tabular shrink-0 font-medium">{formatZAR(x.amount)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tx.amount > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <Button size="sm" onClick={() => onRecordPayment(tx)}><Plus size={13} /> Record as a new payment (no invoice)</Button>
        </div>
      )}
    </Modal>
  )
}

function IgnoreModal({ tx, onClose, onIgnore }: { tx: BankTransaction | null; onClose: () => void; onIgnore: (reason: string) => void }) {
  const [reason, setReason] = useState(IGNORE_REASONS[0])
  const [other, setOther] = useState('')
  if (!tx) return null
  return (
    <Modal
      open
      onClose={onClose}
      title="Ignore transaction"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={() => onIgnore(reason === 'Other' ? other || 'Other' : reason)}>Ignore</Button></>}
    >
      <p className="mb-3 text-sm text-slate-600">{formatDate(tx.date)} · {tx.description} · {formatZAR(tx.amount)}</p>
      <div className="space-y-2">
        {IGNORE_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm"><input type="radio" checked={reason === r} onChange={() => setReason(r)} /> {r}</label>
        ))}
        {reason === 'Other' && <input className="input" placeholder="Reason" value={other} onChange={(e) => setOther(e.target.value)} />}
      </div>
    </Modal>
  )
}

function AccountModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (a: BankAccount) => void }) {
  const [name, setName] = useState('Business cheque account')
  const [bank, setBank] = useState<Bank>('fnb')
  const [last4, setLast4] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setSaving(true)
    setError(null)
    try {
      onSaved(await bankAccounts.create({ name, bank, account_number_last4: last4 || null }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add bank account" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={save} loading={saving}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Bank">
          <select className="input" value={bank} onChange={(e) => setBank(e.target.value as Bank)}>
            {BANKS.map((b) => <option key={b} value={b}>{b === 'fnb' || b === 'absa' ? b.toUpperCase() : labelize(b)}</option>)}
          </select>
        </Field>
        <Field label="Last 4 digits"><input className="input" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
