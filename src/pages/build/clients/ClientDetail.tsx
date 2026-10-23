import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Trash2 } from 'lucide-react'
import {
  companies,
  contactName,
  contacts,
  invoices as invoicesApi,
  listQuoteTotals,
  payments as paymentsApi,
  projects as projectsApi,
  quotes as quotesApi,
} from '../../../lib/api'
import { formatDate, formatZAR } from '../../../lib/format'
import { invoiceTotal, paidByInvoice } from '../../../lib/finance'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, EmptyState, ErrorBanner, Field, PageHeader, Spinner, StatusBadge } from '../../../components/ui'
import type { Company, Contact } from '../../../types'
import { paths } from '../paths'
import { ClientEmails } from './ClientEmails'

/** One page for both client kinds: /clients/company/:id and /clients/contact/:id. */
export function ClientDetail({ kind }: { kind: 'company' | 'contact' }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useLoad(async () => {
    const [company, contact, people, allQuotes, totals, allProjects, allInvoices, allPayments] = await Promise.all([
      kind === 'company' ? companies.get(id) : Promise.resolve(null),
      kind === 'contact' ? contacts.get(id) : Promise.resolve(null),
      kind === 'company' ? contacts.list({ company_id: id }) : Promise.resolve([] as Contact[]),
      quotesApi.list(),
      listQuoteTotals(),
      projectsApi.list(),
      invoicesApi.list(),
      paymentsApi.list(),
    ])
    const mine = <T extends { company_id: string | null; contact_id: string | null }>(r: T) =>
      kind === 'company' ? r.company_id === id : r.contact_id === id
    return {
      company,
      contact,
      people,
      quotes: allQuotes.filter(mine),
      totals,
      projects: allProjects.filter(mine),
      invoices: allInvoices.filter(mine),
      paid: paidByInvoice(allPayments),
    }
  }, [id, kind], 'client')

  const [form, setForm] = useState<Partial<Company & Contact>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  useEffect(() => {
    if (data) setForm((data.company ?? data.contact ?? {}) as Partial<Company & Contact>)
  }, [data])

  if (loading && !data) return <Spinner page />
  if (!data || (!data.company && !data.contact)) return <ErrorBanner error={error ?? 'Client not found'} />

  const name = data.company ? data.company.name : contactName(data.contact)
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v || null }))

  async function save() {
    setSaveError(null)
    if (kind === 'company' && !form.name?.trim()) return setSaveError('Company name is required.')
    setSaving(true)
    try {
      if (kind === 'company') {
        await companies.update(id, { name: form.name?.trim() ?? '', email: form.email ?? null, phone: form.phone ?? null, address: form.address ?? null, city: form.city ?? null, vat_no: form.vat_no ?? null, reg_no: form.reg_no ?? null, notes: form.notes ?? null })
      } else {
        await contacts.update(id, { first_name: form.first_name ?? '', last_name: form.last_name ?? '', email: form.email ?? null, mobile: form.mobile ?? null, phone: form.phone ?? null, address: form.address ?? null, notes: form.notes ?? null })
      }
      reload()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const people = data?.people.length ?? 0
    const peopleNote = people > 0
      ? ` Its ${people === 1 ? 'contact person' : `${people} contact people`} (${data!.people.map(contactName).join(', ')}) will be kept as private clients.`
      : ''
    if (!window.confirm(`Delete ${name}? Quotes and projects keep their history but lose the client link.${peopleNote}`)) return
    try {
      if (kind === 'company') await companies.remove(id)
      else await contacts.remove(id)
      navigate(paths.clients())
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  const invoiced = data.invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + invoiceTotal(i), 0)
  const received = data.invoices.reduce((s, i) => s + (data.paid.get(i.id) ?? 0), 0)

  return (
    <div>
      <Link to={paths.clients()} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> Clients</Link>
      <PageHeader title={name} subtitle={kind === 'company' ? 'Company client' : 'Private client'} actions={<Button variant="danger" size="sm" onClick={remove}><Trash2 size={14} /> Delete</Button>} />
      <ErrorBanner error={error ?? saveError} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Details" actions={<Button size="sm" variant="dark" onClick={save} loading={saving}><Save size={13} /> Save</Button>}>
          <div className="grid gap-3">
            {kind === 'company' ? (
              <Field label="Name"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name"><input className="input" value={form.first_name ?? ''} onChange={(e) => set('first_name', e.target.value)} /></Field>
                <Field label="Last name"><input className="input" value={form.last_name ?? ''} onChange={(e) => set('last_name', e.target.value)} /></Field>
              </div>
            )}
            <Field label="Email"><input className="input" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label={kind === 'company' ? 'Phone' : 'Mobile'}>
              <input className="input" type="tel" value={(kind === 'company' ? form.phone : form.mobile) ?? ''} onChange={(e) => set(kind === 'company' ? 'phone' : 'mobile', e.target.value)} />
            </Field>
            <Field label="Address"><textarea className="input" value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
            {kind === 'company' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="VAT no."><input className="input" value={form.vat_no ?? ''} onChange={(e) => set('vat_no', e.target.value)} /></Field>
                <Field label="Reg. no."><input className="input" value={form.reg_no ?? ''} onChange={(e) => set('reg_no', e.target.value)} /></Field>
              </div>
            )}
            <Field label="Notes"><textarea className="input" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
            {kind === 'company' && data.people.length > 0 && (
              <div>
                <p className="label">People</p>
                <ul className="space-y-1 text-sm">
                  {data.people.map((p) => <li key={p.id}>{contactName(p)} <span className="text-slate-500">{p.email ?? p.mobile ?? ''}</span></li>)}
                </ul>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-5"><p className="text-xs font-medium text-slate-400">Invoiced (incl. VAT)</p><p className="tabular text-lg font-semibold">{formatZAR(invoiced)}</p></div>
            <div className="card p-5"><p className="text-xs font-medium text-slate-400">Received</p><p className="tabular text-lg font-semibold">{formatZAR(received)}</p></div>
          </div>
          <ClientEmails company={data.company} contact={data.contact} people={data.people} />
          <Card title="Projects" padded={false}>
            {data.projects.length === 0 ? <EmptyState title="No projects" /> : (
              <ul className="divide-y divide-slate-100">
                {data.projects.map((p) => (
                  <li key={p.id}><Link to={paths.project(p.id)} className="flex justify-between px-4 py-2.5 text-sm hover:bg-slate-50"><span>{p.name}</span><StatusBadge status={p.status} /></Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Quotes" padded={false}>
            {data.quotes.length === 0 ? <EmptyState title="No quotes" /> : (
              <ul className="divide-y divide-slate-100">
                {data.quotes.map((q) => (
                  <li key={q.id}>
                    <Link to={paths.quote(q.id)} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
                      <span><span className="font-mono text-xs text-slate-400">{q.number}</span> {q.title}</span>
                      <span className="flex items-center gap-2"><span className="tabular">{formatZAR(data.totals.get(q.id)?.total_incl ?? 0)}</span><StatusBadge status={q.status} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Invoices" padded={false}>
            {data.invoices.length === 0 ? <EmptyState title="No invoices" /> : (
              <ul className="divide-y divide-slate-100">
                {data.invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span><span className="font-mono text-xs text-slate-400">{i.number}</span> {formatDate(i.issue_date)}</span>
                    <span className="flex items-center gap-2"><span className="tabular">{formatZAR(invoiceTotal(i))}</span><StatusBadge status={i.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
