import { parseISO } from 'date-fns'
import { NumInput } from '../../../components/ui/NumInput'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Camera, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  clientLabel,
  diaryEvents,
  expenses as expensesApi,
  getProjectFinancials,
  invoices as invoicesApi,
  listLinkedExpenseIds,
  listProfiles,
  listQuoteItems,
  projectStages,
  stageBookings,
  workers as workersApi,
  loadClientDirectory,
  payments as paymentsApi,
  projects as projectsApi,
  quotes as quotesApi,
  siteDiary,
  variations as variationsApi,
} from '../../../lib/api'
import { formatDate, formatDateTime, formatPct, formatZAR, labelize, round2, todayYmd } from '../../../lib/format'
import { invoiceTotal, paidByInvoice } from '../../../lib/finance'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, ProgressBar, Spinner, StatTile, StatusBadge, Tabs } from '../../../components/ui'
import {
  EXPENSE_CATEGORIES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  type DiaryEvent,
  type Expense,
  type Invoice,
  type InvoiceStatus,
  type Payment,
  type PaymentMethod,
  type SiteDiaryEntry,
  type Variation,
} from '../../../types'
import { ExpenseFormModal } from '../components/ExpenseFormModal'
import { ExpenseTable } from '../components/ExpenseTable'
import { EventFormModal } from '../components/EventFormModal'
import { SiteDiaryForm } from '../components/SiteDiaryForm'
import { paths } from '../paths'
import { LazyCategoryBarChart } from '../components/LazyCharts'
import { useVatRate } from '../BuildContext'
import { ProjectFormModal } from './ProjectFormModal'
import { PlanTab } from './PlanTab'
import { JobScorecard } from './JobScorecard'
import { crewCost } from '../../../lib/jobScore'

type Tab = 'overview' | 'plan' | 'expenses' | 'invoices' | 'variations' | 'diary' | 'schedule'

/** Runs a click action, reporting any failure to the page's error banner. */
type Act = (fn: () => Promise<unknown>) => Promise<void>

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function load(id: string) {
  const [project, fin, dir, exp, inv, pay, vars, entries, events, linked, team, allProjects] = await Promise.all([
    projectsApi.get(id),
    getProjectFinancials(id),
    loadClientDirectory(),
    expensesApi.list({ project_id: id }),
    invoicesApi.list({ project_id: id }),
    paymentsApi.list({ project_id: id }),
    variationsApi.list({ project_id: id }),
    siteDiary.list({ project_id: id }),
    diaryEvents.list({ project_id: id }),
    listLinkedExpenseIds(),
    listProfiles(),
    projectsApi.list(),
  ])
  // For the scorecard: the quote's lines (quoted cost by kind) and the crew's booked days (actual labour).
  const [quote, items, stages, allBookings, workerRows] = await Promise.all([
    project?.quote_id ? quotesApi.get(project.quote_id) : Promise.resolve(null),
    project?.quote_id ? listQuoteItems(project.quote_id) : Promise.resolve([]),
    projectStages.list({ project_id: id }),
    stageBookings.list(),
    workersApi.list(),
  ])
  const stageIds = new Set(stages.map((st) => st.id))
  const bookings = allBookings.filter((b) => stageIds.has(b.stage_id))
  const workerMap = new Map(workerRows.map((w) => [w.id, w]))
  return { project, fin, dir, exp, inv, pay, vars, entries, events, linked, team, allProjects, quote, items, bookings, workerMap }
}

export function ProjectDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'overview'
  const { data, error, loading, reload } = useLoad(() => load(id), [id], 'project')
  const [editing, setEditing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const act: Act = async (fn) => {
    setActionError(null)
    try {
      await fn()
    } catch (e) {
      setActionError(errMsg(e))
    }
  }

  if (loading && !data) return <Spinner page />
  if (!data?.project) return <ErrorBanner error={error ?? 'Project not found'} />
  const { project } = data

  return (
    <div>
      <Link to={paths.projects()} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> Projects</Link>
      <PageHeader
        title={project.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={project.status} />
            {project.code && <span className="font-mono text-xs">{project.code}</span>}
            <span>{clientLabel(data.dir, project)}</span>
            {project.site_address && <span>· {project.site_address}</span>}
          </span>
        }
        actions={
          <>
            <Button onClick={() => setEditing(true)}><Pencil size={14} /> Edit</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!window.confirm('Delete this project? Its variations, site diary and scheduled events are deleted with it; expenses and invoices are kept as unassigned.')) return
                act(async () => {
                  await projectsApi.remove(project.id)
                  navigate(paths.projects())
                })
              }}
            >
              <Trash2 size={14} />
            </Button>
          </>
        }
      />
      <ErrorBanner error={actionError ?? error} />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'plan', label: 'Plan & crew' },
          { id: 'expenses', label: `Expenses (${data.exp.length})` },
          { id: 'invoices', label: 'Invoices & payments' },
          { id: 'variations', label: `Variations (${data.vars.length})` },
          { id: 'diary', label: 'Site diary' },
          { id: 'schedule', label: 'Events' },
        ]}
      />

      {tab === 'overview' && <Overview data={data} />}
      {tab === 'plan' && <PlanTab project={project} quote={data.quote} onProjectChanged={reload} />}
      {tab === 'expenses' && <ExpensesTab projectId={project.id} rows={data.exp} projects={data.allProjects} linked={data.linked} reload={reload} act={act} />}
      {tab === 'invoices' && <InvoicesTab data={data} reload={reload} act={act} />}
      {tab === 'variations' && <VariationsTab projectId={project.id} rows={data.vars} reload={reload} act={act} />}
      {tab === 'diary' && <DiaryTab projectId={project.id} rows={data.entries} projects={data.allProjects} reload={reload} />}
      {tab === 'schedule' && <ScheduleTab data={data} reload={reload} />}

      <ProjectFormModal open={editing} editing={project} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />
    </div>
  )
}

type Data = Awaited<ReturnType<typeof load>>

function Overview({ data }: { data: Data }) {
  const p = data.project!
  const f = data.fin
  const byCat = EXPENSE_CATEGORIES.map((c) => ({ name: labelize(c), value: Number(f?.[`expenses_${c}` as const] ?? 0) })).filter((x) => x.value > 0)
  // Spent and profit include the crew's booked days, as the scorecard below and Plan & crew count them.
  const crew = crewCost(data.bookings, data.workerMap, todayYmd())
  const spent = round2((f?.expenses_total ?? 0) + crew)
  const revised = f?.revised_contract ?? p.contract_value
  const profit = round2(revised - spent)
  const margin = revised ? (profit / revised) * 100 : null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Revised contract" value={formatZAR(f?.revised_contract ?? p.contract_value, { decimals: 0 })} hint={f?.approved_variations ? `incl. ${formatZAR(f.approved_variations, { decimals: 0 })} variations` : 'excl. VAT'} />
        <StatTile label="Spent" value={formatZAR(spent, { decimals: 0 })} hint={crew ? `excl. VAT, incl. ${formatZAR(crew, { decimals: 0 })} crew` : 'excl. VAT'} />
        <StatTile label="Gross profit" value={formatZAR(profit, { decimals: 0 })} tone={profit < 0 ? 'bad' : 'good'} hint={`Margin ${formatPct(margin)}`} />
        <StatTile label="Received" value={formatZAR(f?.received ?? 0, { decimals: 0 })} hint={`Invoiced ${formatZAR(f?.invoiced_incl ?? 0, { decimals: 0 })} incl. VAT`} />
      </div>
      <JobScorecard project={p} quote={data.quote} items={data.items} expenses={data.exp} bookings={data.bookings} workers={data.workerMap} variations={Number(f?.approved_variations ?? 0)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Budget">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-slate-600">{formatZAR(spent)} of {formatZAR(p.budget)}</span>
            <span className={`font-medium ${p.budget - spent < 0 ? 'text-red-600' : 'text-slate-800'}`}>{formatZAR(round2(p.budget - spent))} left</span>
          </div>
          <ProgressBar value={spent} max={p.budget} />
          <p className="mt-2 text-xs text-slate-500">{p.budget ? `${formatPct((spent / p.budget) * 100, 0)} of budget used` : 'No budget set'}</p>
          <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Start</dt><dd>{formatDate(p.start_date)}</dd>
            <dt className="text-slate-500">End</dt><dd>{formatDate(p.end_date)}</dd>
            <dt className="text-slate-500">Quote</dt>
            <dd>{data.quote ? <Link className="text-brand-700 hover:underline" to={paths.quote(data.quote.id)}>{data.quote.number}</Link> : '—'}</dd>
            <dt className="text-slate-500">Contract value</dt><dd className="tabular">{formatZAR(p.contract_value)}</dd>
          </dl>
          {p.notes && <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{p.notes}</p>}
        </Card>
        <Card title="Expenses by category">
          {byCat.length === 0 ? (
            <EmptyState title="No expenses yet" />
          ) : (
            <div className="h-64">
              <LazyCategoryBarChart data={byCat} />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function ExpensesTab({ projectId, rows, projects, linked, reload, act }: { projectId: string; rows: Expense[]; projects: Data['allProjects']; linked: Set<string>; reload: () => void; act: Act }) {
  const [editing, setEditing] = useState<Expense | null>(null)
  const [adding, setAdding] = useState(false)
  const total = rows.reduce((s, e) => s + e.amount_excl, 0)
  return (
    <Card
      title={`Expenses · ${formatZAR(total)} excl. VAT`}
      padded={false}
      actions={
        <>
          <Link to={`${paths.capture()}?project=${projectId}`} className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1.5 text-xs font-semibold text-white"><Camera size={13} /> Snap slip</Link>
          <Button size="sm" onClick={() => setAdding(true)}><Plus size={13} /> Add</Button>
        </>
      }
    >
      <ExpenseTable
        rows={rows}
        projects={projects}
        linked={linked}
        showProject={false}
        onEdit={setEditing}
        onDelete={(e) => {
          if (!window.confirm('Delete this expense?')) return
          act(async () => {
            await expensesApi.remove(e.id)
            reload()
          })
        }}
      />
      <ExpenseFormModal
        open={adding || !!editing}
        editing={editing}
        initial={{ project_id: projectId }}
        projects={projects}
        onClose={() => { setAdding(false); setEditing(null) }}
        onSaved={() => { setAdding(false); setEditing(null); reload() }}
      />
    </Card>
  )
}

function InvoicesTab({ data, reload, act }: { data: Data; reload: () => void; act: Act }) {
  const vatRate = useVatRate()
  const p = data.project!
  const [invOpen, setInvOpen] = useState(false)
  const [payOpen, setPayOpen] = useState<{ invoice?: Invoice } | null>(null)
  const [inv, setInv] = useState<Partial<Invoice>>({})
  const [pay, setPay] = useState<Partial<Payment>>({})
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const paid = paidByInvoice(data.pay)

  function openInvoice() {
    setInv({ issue_date: todayYmd(), due_date: todayYmd(), status: 'draft', amount_excl: 0, vat: 0, description: p.name })
    setErr(null)
    setInvOpen(true)
  }
  const outstandingOn = (invoice: Invoice) => Math.max(0, round2(invoiceTotal(invoice) - (paid.get(invoice.id) ?? 0)))
  function openPayment(invoice?: Invoice) {
    const outstanding = invoice ? outstandingOn(invoice) : 0
    setPay({ date: todayYmd(), amount: outstanding, method: 'eft', invoice_id: invoice?.id ?? null, reference: invoice?.number ?? '' })
    setErr(null)
    setPayOpen({ invoice })
  }

  async function saveInvoice() {
    if (!inv.issue_date) return setErr('Enter the issue date.')
    if (inv.due_date && inv.due_date < inv.issue_date) return setErr('The due date is before the issue date.')
    setErr(null)
    setSaving(true)
    try {
      await invoicesApi.create({
        ...inv,
        due_date: inv.due_date || null,
        project_id: p.id,
        company_id: p.company_id,
        contact_id: p.contact_id,
        amount_excl: Number(inv.amount_excl),
        vat: Number(inv.vat),
      })
      setInvOpen(false)
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function savePayment() {
    if (!pay.date) return setErr('Enter the payment date.')
    if (!(Number(pay.amount) > 0)) return setErr('Enter the amount received.')
    setErr(null)
    setSaving(true)
    try {
      await paymentsApi.create({ ...pay, reference: pay.reference?.trim() || null, project_id: p.id, amount: Number(pay.amount) })
      // Only a fully paid invoice flips to paid; a part payment leaves the status alone.
      if (pay.invoice_id) {
        const invoice = data.inv.find((i) => i.id === pay.invoice_id)
        const fullyPaid = invoice && round2((paid.get(invoice.id) ?? 0) + Number(pay.amount)) >= invoiceTotal(invoice) - 0.005
        if (invoice && fullyPaid && invoice.status !== 'paid' && invoice.status !== 'cancelled') await invoicesApi.update(invoice.id, { status: 'paid' })
      }
      setPayOpen(null)
      reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /** Deletes a payment; a 'paid' invoice it no longer fully covers goes back to 'sent'. */
  async function deletePayment(pm: Payment) {
    await paymentsApi.remove(pm.id)
    const invoice = pm.invoice_id ? data.inv.find((i) => i.id === pm.invoice_id) : undefined
    if (invoice?.status === 'paid' && round2((paid.get(invoice.id) ?? 0) - Number(pm.amount)) < invoiceTotal(invoice) - 0.005) {
      await invoicesApi.update(invoice.id, { status: 'sent' })
    }
    reload()
  }

  return (
    <div className="space-y-4">
      <Card title="Invoices" padded={false} actions={<Button size="sm" onClick={openInvoice}><Plus size={13} /> New invoice</Button>}>
        {data.inv.length === 0 ? <EmptyState title="No invoices yet" /> : (
          <ul className="divide-y divide-slate-100">
            {data.inv.map((i) => {
              const total = invoiceTotal(i)
              const got = paid.get(i.id) ?? 0
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-mono text-xs text-slate-500">{i.number}</span>
                  <span className="min-w-0 flex-1 truncate">{i.description}<span className="block text-xs text-slate-500">Issued {formatDate(i.issue_date)} · due {formatDate(i.due_date)}</span></span>
                  <span className="tabular text-right">{formatZAR(total)}<span className="block text-xs text-slate-500">paid {formatZAR(got)}</span></span>
                  <select className="rounded border border-slate-200 px-1.5 py-1 text-xs" value={i.status} onChange={(e) => { const status = e.target.value as InvoiceStatus; act(async () => { await invoicesApi.update(i.id, { status }); reload() }) }}>
                    {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
                  </select>
                  {got < total - 0.005 && i.status !== 'cancelled' && <Button size="sm" onClick={() => openPayment(i)}>Record payment</Button>}
                  <button className="text-slate-400 hover:text-red-600" onClick={() => { if (window.confirm('Delete invoice?')) act(async () => { await invoicesApi.remove(i.id); reload() }) }} aria-label="Delete"><Trash2 size={14} /></button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <Card title="Payments received" padded={false} actions={<Button size="sm" onClick={() => openPayment()}><Plus size={13} /> Payment</Button>}>
        {data.pay.length === 0 ? <EmptyState title="No payments yet" /> : (
          <ul className="divide-y divide-slate-100">
            {data.pay.map((pm) => (
              <li key={pm.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1">{formatDate(pm.date)} <span className="text-xs text-slate-500">· {labelize(pm.method)} {pm.reference ? `· ${pm.reference}` : ''} {pm.invoice_id ? `· ${data.inv.find((i) => i.id === pm.invoice_id)?.number ?? ''}` : ''}</span></span>
                <span className="tabular font-medium">{formatZAR(pm.amount)}</span>
                <button className="text-slate-400 hover:text-red-600" onClick={() => { if (window.confirm('Delete payment?')) act(() => deletePayment(pm)) }} aria-label="Delete"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={invOpen} onClose={() => setInvOpen(false)} title="New invoice" footer={<><Button variant="ghost" onClick={() => setInvOpen(false)}>Cancel</Button><Button variant="dark" onClick={saveInvoice} loading={saving}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Description" className="sm:col-span-2"><input className="input" value={inv.description ?? ''} onChange={(e) => setInv({ ...inv, description: e.target.value })} /></Field>
          <Field label="Issue date"><input type="date" className="input" value={inv.issue_date ?? ''} onChange={(e) => setInv({ ...inv, issue_date: e.target.value })} /></Field>
          <Field label="Due date"><input type="date" className="input" value={inv.due_date ?? ''} onChange={(e) => setInv({ ...inv, due_date: e.target.value })} /></Field>
          <Field label="Amount excl. VAT"><NumInput prefix="R" value={inv.amount_excl ?? 0} onValue={(n) => setInv({ ...inv, amount_excl: n, vat: round2((n * vatRate) / 100) })} /></Field>
          <Field label={`VAT (${vatRate}%)`}><NumInput prefix="R" value={inv.vat ?? 0} onValue={(n) => setInv({ ...inv, vat: n })} /></Field>
          <Field label="Status">
            <select className="input" value={inv.status ?? 'draft'} onChange={(e) => setInv({ ...inv, status: e.target.value as InvoiceStatus })}>
              {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
            </select>
          </Field>
          <p className="self-end text-sm text-slate-600">Total {formatZAR(Number(inv.amount_excl ?? 0) + Number(inv.vat ?? 0))}</p>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      </Modal>

      <Modal open={!!payOpen} onClose={() => setPayOpen(null)} title="Record payment" footer={<><Button variant="ghost" onClick={() => setPayOpen(null)}>Cancel</Button><Button variant="dark" onClick={savePayment} loading={saving}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice" className="sm:col-span-2">
            <select className="input" value={pay.invoice_id ?? ''} onChange={(e) => {
              const invoice = data.inv.find((i) => i.id === e.target.value)
              setPay({ ...pay, invoice_id: invoice?.id ?? null, ...(invoice ? { amount: outstandingOn(invoice), reference: !pay.reference || data.inv.some((i) => i.number === pay.reference) ? invoice.number : pay.reference } : {}) })
            }}>
              <option value="">— Not against an invoice —</option>
              {data.inv.map((i) => <option key={i.id} value={i.id}>{i.number} · {formatZAR(invoiceTotal(i))}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" className="input" value={pay.date ?? ''} onChange={(e) => setPay({ ...pay, date: e.target.value })} /></Field>
          <Field label="Amount received"><NumInput prefix="R" value={pay.amount ?? 0} onValue={(n) => setPay({ ...pay, amount: n })} /></Field>
          <Field label="Method">
            <select className="input" value={pay.method ?? 'eft'} onChange={(e) => setPay({ ...pay, method: e.target.value as PaymentMethod })}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Reference"><input className="input" value={pay.reference ?? ''} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
        </div>
        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      </Modal>
    </div>
  )
}

function VariationsTab({ projectId, rows, reload, act }: { projectId: string; rows: Variation[]; reload: () => void; act: Act }) {
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayYmd())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const approved = rows.filter((v) => v.approved).reduce((s, v) => s + v.amount_excl, 0)
  const pending = rows.filter((v) => !v.approved).reduce((s, v) => s + v.amount_excl, 0)

  async function add() {
    if (!desc.trim()) return setErr('Describe the variation.')
    if (!date) return setErr('Enter the variation date.')
    setErr(null)
    setSaving(true)
    try {
      await variationsApi.create({ project_id: projectId, description: desc.trim(), amount_excl: Number(amount || 0), date, approved: false })
      setDesc('')
      setAmount('')
      reload()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title={`Variations · approved ${formatZAR(approved)} · pending ${formatZAR(pending)}`} padded={false}>
      <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-[1fr_140px_150px_auto]">
        <input className="input" placeholder="Description (e.g. Extra window in bedroom 2)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <NumInput allowEmpty prefix="R" placeholder="Amount excl. VAT" value={amount === '' ? null : Number(amount)} onValue={(n) => setAmount(n === null ? '' : String(n))} />
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button variant="dark" onClick={add} loading={saving}><Plus size={14} /> Add</Button>
        {err && <p className="text-sm text-red-600 sm:col-span-4">{err}</p>}
      </div>
      {rows.length === 0 ? <EmptyState title="No variations">Changes to the contract scope go here. Approved ones add to the revised contract value.</EmptyState> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((v) => (
            <li key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="flex-1">{v.description}<span className="block text-xs text-slate-500">{formatDate(v.date)}</span></span>
              <span className={`tabular font-medium ${v.amount_excl < 0 ? 'text-red-600' : ''}`}>{formatZAR(v.amount_excl)}</span>
              <button
                onClick={() => act(async () => { await variationsApi.update(v.id, { approved: !v.approved }); reload() })}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${v.approved ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {v.approved && <Check size={12} />} {v.approved ? 'Approved' : 'Approve'}
              </button>
              <button className="text-slate-400 hover:text-red-600" onClick={() => { if (window.confirm('Delete variation?')) act(async () => { await variationsApi.remove(v.id); reload() }) }} aria-label="Delete"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function SiteDiaryList({ rows, projectName, onEdit }: { rows: SiteDiaryEntry[]; projectName?: (id: string) => string; onEdit: (e: SiteDiaryEntry) => void }) {
  if (rows.length === 0) return <EmptyState title="No site diary entries">Log weather, crew, work done and delays each day you're on site.</EmptyState>
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((e) => (
        <li key={e.id} className="px-4 py-3">
          <button className="w-full text-left" onClick={() => onEdit(e)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">{formatDate(e.date, 'EEE d MMM yyyy')}{projectName ? ` · ${projectName(e.project_id)}` : ''}</span>
              <span className="text-xs text-slate-500">{[e.weather, e.workers_on_site !== null ? `${e.workers_on_site} on site` : null].filter(Boolean).join(' · ')}</span>
            </div>
            {e.work_done && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{e.work_done}</p>}
            {e.materials_delivered && <p className="mt-1 text-xs text-slate-600"><strong>Deliveries:</strong> {e.materials_delivered}</p>}
            {e.delays && <p className="mt-1 text-xs text-orange-700"><strong>Delays:</strong> {e.delays}</p>}
            {e.safety_notes && <p className="mt-1 text-xs text-red-700"><strong>Safety:</strong> {e.safety_notes}</p>}
          </button>
        </li>
      ))}
    </ul>
  )
}

function DiaryTab({ projectId, rows, projects, reload }: { projectId: string; rows: SiteDiaryEntry[]; projects: Data['allProjects']; reload: () => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SiteDiaryEntry | null>(null)
  return (
    <Card title="Site diary" padded={false} actions={<Button size="sm" variant="primary" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={13} /> Today's entry</Button>}>
      <SiteDiaryList rows={rows} onEdit={(e) => { setEditing(e); setOpen(true) }} />
      <SiteDiaryForm open={open} editing={editing} projectId={projectId} projects={projects} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload() }} />
    </Card>
  )
}

function ScheduleTab({ data, reload }: { data: Data; reload: () => void }) {
  const p = data.project!
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<DiaryEvent | null>(null)
  const upcoming = data.events.filter((e) => new Date(e.start_at) >= new Date(new Date().toDateString()))
  const past = data.events.filter((e) => !upcoming.includes(e)).reverse()
  const row = (e: DiaryEvent) => (
    <li key={e.id}>
      <button className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50" onClick={() => { setEditing(e); setOpen(true) }}>
        <span><span className="font-medium text-slate-800">{e.title}</span><span className="block text-xs text-slate-500">{labelize(e.type)}{e.location ? ` · ${e.location}` : ''}</span></span>
        <span className="text-xs text-slate-500">{e.all_day ? formatDate(e.start_at) : formatDateTime(e.start_at)}</span>
      </button>
    </li>
  )
  return (
    <div className="space-y-4">
      <Card title="Programme">
        <p className="text-sm text-slate-600">Start {formatDate(p.start_date)} → end {formatDate(p.end_date)}</p>
        {p.start_date && p.end_date && (() => {
          // parseISO reads YYYY-MM-DD as local midnight (new Date() would read it as UTC).
          const s = parseISO(p.start_date).getTime()
          const e = parseISO(p.end_date).getTime()
          const now = Date.now()
          const pct = e > s ? Math.max(0, Math.min(100, ((now - s) / (e - s)) * 100)) : now >= s ? 100 : 0
          return (
            <div className="mt-2">
              <ProgressBar value={pct} max={100} tone="accent" />
              <p className="mt-1 text-xs text-slate-500">{Math.round(pct)}% of the programme elapsed</p>
            </div>
          )
        })()}
      </Card>
      <Card title="Scheduled events" padded={false} actions={<Button size="sm" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={13} /> Event</Button>}>
        {data.events.length === 0 ? <EmptyState title="Nothing scheduled">Site visits, inspections and deliveries for this project show here and in the Diary.</EmptyState> : (
          <>
            {upcoming.length > 0 && <ul className="divide-y divide-slate-100">{upcoming.map(row)}</ul>}
            {past.length > 0 && <><p className="bg-slate-50 px-4 py-1.5 text-xs font-medium uppercase text-slate-400">Past</p><ul className="divide-y divide-slate-100 opacity-70">{past.map(row)}</ul></>}
          </>
        )}
      </Card>
      <EventFormModal
        open={open}
        editing={editing}
        projects={data.allProjects}
        team={data.team}
        defaults={{ project_id: p.id, location: p.site_address }}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); reload() }}
      />
    </div>
  )
}
