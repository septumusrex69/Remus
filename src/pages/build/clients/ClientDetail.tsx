import { useEffect, useState } from 'react'
import { seesMoney, seesQuotes, useAccess } from '../../../lib/access'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FileText, FolderKanban, Mail, MapPin, Phone, Receipt, Save, Trash2, Wallet } from 'lucide-react'
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
import { Button, Card, EmptyState, ErrorBanner, Field, Spinner, StatusBadge } from '../../../components/ui'
import { HeroAction, HeroFact, RecordFigure, RecordFigures, RecordHero, RecordTabs } from '../../../components/record/RecordShell'
import type { Company, Contact } from '../../../types'
import { paths } from '../paths'
import { ClientEmails } from './ClientEmails'
import { PortalAccessCard } from './PortalAccessCard'

type ClientTab = 'overview' | 'emails' | 'quotes' | 'invoices'

/** One page for both client kinds: /clients/company/:id and /clients/contact/:id. */
export function ClientDetail({ kind }: { kind: 'company' | 'contact' }) {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  // Invoices and what was paid are money; quotes are not a site manager's (lib/access.ts).
  const access = useAccess()
  const money = seesMoney(access)
  const quotesToo = seesQuotes(access)
  /*
   * RAPTOR'S TABS, WITH ?tab= LINKS (Remus · Handover 8). A link with ?email=<id> (the top bar's envelope)
   * opens the Emails tab, where that message is. A tab somebody may not see falls back to the Overview.
   */
  const [params, setParams] = useSearchParams()
  const asked = (params.get('tab') as ClientTab | null) ?? (params.get('email') ? 'emails' : 'overview')
  const tab: ClientTab = (asked === 'quotes' && !quotesToo) || (asked === 'invoices' && !money) || !['overview', 'emails', 'quotes', 'invoices'].includes(asked) ? 'overview' : asked
  const setTab = (t: ClientTab) => setParams((p) => { const next = new URLSearchParams(p); next.set('tab', t); return next }, { replace: true })
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
      // The company a private client works for, for the band ("Contact at ...").
      employer: contact?.company_id ? await companies.get(contact.company_id).catch(() => null) : null,
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

  const record = data.company ?? data.contact
  const phone = data.company ? data.company.phone : data.contact?.mobile || data.contact?.phone
  const place = data.company ? [data.company.city, data.company.address && !data.company.city ? data.company.address : null].filter(Boolean).join(', ') : data.contact?.address
  const running = data.projects.filter((p) => p.status === 'active' || p.status === 'planned').length
  const openQuotes = data.quotes.filter((q) => q.status === 'draft' || q.status === 'sent').length
  const figures = 1 + (quotesToo ? 1 : 0) + (money ? 2 : 0)

  const details = (
    <Card title="Details" subtitle={kind === 'company' ? 'The company, its numbers and its people.' : 'How to reach them.'} actions={<Button size="sm" variant="dark" onClick={save} loading={saving}><Save size={13} /> Save</Button>}>
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
              {data.people.map((p) => <li key={p.id}><Link to={paths.contact(p.id)} className="hover:underline">{contactName(p)}</Link> <span className="text-slate-500">{p.email ?? p.mobile ?? ''}</span></li>)}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )

  return (
    <div className="space-y-4">
      <Link to={paths.clients()} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> Clients</Link>
      {/*
        RAPTOR'S RECORD PAGE (Remus · Handover 8), from Raptor's client page: the band naming the client with how
        to reach them, the figures under it, then tabs over the detail. The long lists (emails, quotes, invoices)
        get their own tabs, as Raptor's do, so the Overview reads at a glance.
      */}
      <RecordHero
        eyebrow={kind === 'company' ? 'Company client' : 'Private client'}
        title={name}
        subtitle={data.employer ? <span>Contact at <Link to={paths.company(data.employer.id)} className="text-white/85 hover:text-white hover:underline">{data.employer.name}</Link></span> : kind === 'company' && data.people.length > 0 ? `${data.people.length} ${data.people.length === 1 ? 'person' : 'people'} on file` : undefined}
        facts={
          <>
            {running > 0 && <HeroFact dot="bg-emerald-400">{running} job{running === 1 ? '' : 's'} running</HeroFact>}
            {record?.email && <a href={`mailto:${record.email}`} className="max-w-full"><HeroFact icon={Mail}>{record.email}</HeroFact></a>}
            {phone && <a href={`tel:${phone.replace(/\s+/g, '')}`} className="max-w-full"><HeroFact icon={Phone}>{phone}</HeroFact></a>}
            {place && <HeroFact icon={MapPin}>{place}</HeroFact>}
          </>
        }
        actions={
          <>
            <HeroAction primary icon={Mail} label="Emails" onClick={() => setTab('emails')} title="The emails with this client, and write a new one" />
            <HeroAction danger icon={Trash2} title={`Delete ${name}`} onClick={remove} />
          </>
        }
      />
      {/* A site manager sees no money and no quotes: the band already says how many jobs are running. */}
      {figures > 1 && <RecordFigures count={4}>
        <RecordFigure icon={FolderKanban} label="Projects" value={String(data.projects.length)} note={running ? `${running} running` : 'none running'} />
        {quotesToo && <RecordFigure icon={FileText} label="Quotes" value={String(data.quotes.length)} note={openQuotes ? `${openQuotes} open` : 'none open'} onClick={() => setTab('quotes')} title="The quotes for this client" />}
        {money && <RecordFigure icon={Receipt} label="Invoiced" value={formatZAR(invoiced, { decimals: 0 })} note="incl. VAT" onClick={() => setTab('invoices')} title="The invoices for this client" />}
        {money && <RecordFigure icon={Wallet} strong label="Received" value={formatZAR(received, { decimals: 0 })} note={invoiced - received > 0.005 ? `${formatZAR(invoiced - received, { decimals: 0 })} still to come` : 'nothing outstanding'} />}
      </RecordFigures>}
      <ErrorBanner error={error ?? saveError} />
      <RecordTabs<ClientTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'emails', label: 'Emails' },
          ...(quotesToo ? [{ id: 'quotes' as const, label: 'Quotes', count: data.quotes.length }] : []),
          ...(money ? [{ id: 'invoices' as const, label: 'Invoices', count: data.invoices.length }] : []),
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">{details}</div>
          <div className="space-y-4">
            <Card title="Projects" subtitle={data.projects.length ? `${data.projects.length} for this client` : undefined} padded={false}>
              {data.projects.length === 0 ? <EmptyState title="No projects" /> : (
                <ul className="divide-y divide-slate-100">
                  {data.projects.map((p) => (
                    <li key={p.id}><Link to={paths.project(p.id)} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-slate-50"><span className="min-w-0">{p.name}</span><StatusBadge status={p.status} /></Link></li>
                  ))}
                </ul>
              )}
            </Card>
            <PortalAccessCard
              client={kind === 'company' ? { companyId: id } : { contactId: id }}
              clientName={name}
              suggest={{ email: (data.contact ?? data.company)?.email ?? null, name: data.contact ? contactName(data.contact) : '' }}
            />
          </div>
        </div>
      )}

      {tab === 'emails' && <ClientEmails company={data.company} contact={data.contact} people={data.people} />}

      {tab === 'quotes' && quotesToo && <Card title="Quotes" subtitle={`${data.quotes.length} for this client · ${openQuotes} open`} padded={false}>
        {data.quotes.length === 0 ? <EmptyState title="No quotes" /> : (
          <ul className="divide-y divide-slate-100">
            {data.quotes.map((q) => (
              <li key={q.id}>
                <Link to={paths.quote(q.id)} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
                  <span className="min-w-0"><span className="font-mono text-xs text-slate-400">{q.number}</span> {q.title}</span>
                  <span className="flex shrink-0 items-center gap-2"><span className="tabular">{formatZAR(data.totals.get(q.id)?.total_incl ?? 0)}</span><StatusBadge status={q.status} /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>}

      {tab === 'invoices' && money && <Card title="Invoices" subtitle={`${formatZAR(invoiced)} invoiced · ${formatZAR(received)} received`} padded={false}>
        {data.invoices.length === 0 ? <EmptyState title="No invoices" /> : (
          <ul className="divide-y divide-slate-100">
            {data.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0"><span className="font-mono text-xs text-slate-400">{i.number}</span> {formatDate(i.issue_date)}</span>
                <span className="flex shrink-0 items-center gap-2"><span className="tabular">{formatZAR(invoiceTotal(i))}</span><StatusBadge status={i.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </Card>}
    </div>
  )
}
