import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Ban, Download, FilePlus2, FileSignature, FileText, Mail, MessageCircle, PenLine, Save, Trash2 } from 'lucide-react'
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../ui'
import { useLoad } from '../../hooks/useLoad'
import { useAuth } from '../../store/AuthContext'
import { useBuild } from '../../pages/build/BuildContext'
import { useAccess, seesMoney, seesQuotes } from '../../lib/access'
import {
  companies as companiesApi, contacts as contactsApi, contactName, invoices as invoicesApi, listQuoteTotals,
  payments as paymentsApi, quotes as quotesApi, variations as variationsApi,
} from '../../lib/api'
import {
  cancelSigning, createDocument, deleteDocument, documentPdf, emailDocument, listDocuments, listSigningRequests,
  listTemplates, shareFile, showFile, signedPdf, updateDocument, type DocumentTemplate, type ProjectDocument,
} from '../../lib/documentsApi'
import { DOC_KIND, MONEY_FREE_KINDS, fieldLabel, mergeValues, needs, renderTemplate } from '../../lib/documentTemplates'
import { SIGNING_STATUS, latestFor, signingStatus, type SigningRequestRow } from '../../lib/signingStatus'
import { todayYmd, formatDate, formatDateTime, formatZAR } from '../../lib/format'
import { DocumentSheet } from './DocumentSheet'
import { SendForSigningModal } from './SendForSigningModal'
import type { Company, Contact, Invoice, Project, Quote, QuoteTotalsRow, Variation } from '../../types'

/**
 * A PROJECT'S DOCUMENTS (Remus · Handover 8): the Library's documents made for this job, and everything sent
 * from it for signing. Stephan, 7 Nov, on Raptor's Library: "we can start with pretty much all of that"; and on
 * online signing: "you can build it, and if other people are going to use it, you can try that."
 *
 * Make a document from a template (the job, its client, its quote and, where the wording asks, a variation or
 * an invoice fill the merge fields), edit the words, see it on the letterhead, then PDF, email (the same path
 * as a quote: your own mailbox), WhatsApp (the share sheet with the PDF), or send it for signing. The project's
 * quote and its variations can be sent for signing from here too.
 */

interface Loaded {
  templates: DocumentTemplate[]
  docs: ProjectDocument[]
  signing: SigningRequestRow[]
  company: Company | null
  contact: Contact | null
  quotes: Quote[]
  totals: Map<string, QuoteTotalsRow>
  variations: Variation[]
  invoices: Invoice[]
  paidByInvoice: Map<string, number>
}

async function load(project: Project, money: boolean, quotesToo: boolean): Promise<Loaded> {
  const [templates, docs, signing, company, contact, quotesHere, ownQuote] = await Promise.all([
    listTemplates().catch(() => [] as DocumentTemplate[]),
    listDocuments({ project_id: project.id }),
    listSigningRequests({ project_id: project.id }),
    project.company_id ? companiesApi.get(project.company_id).catch(() => null) : Promise.resolve(null),
    project.contact_id ? contactsApi.get(project.contact_id).catch(() => null) : Promise.resolve(null),
    quotesToo ? quotesApi.list({ project_id: project.id }).catch(() => [] as Quote[]) : Promise.resolve([] as Quote[]),
    quotesToo && project.quote_id ? quotesApi.get(project.quote_id).catch(() => null) : Promise.resolve(null),
  ])
  const quotes = [...(ownQuote ? [ownQuote] : []), ...quotesHere.filter((q) => q.id !== ownQuote?.id)]
  const [totals, variations, invoices, payments] = await Promise.all([
    money && quotes.length ? listQuoteTotals().catch(() => new Map<string, QuoteTotalsRow>()) : Promise.resolve(new Map<string, QuoteTotalsRow>()),
    money ? variationsApi.list({ project_id: project.id }).catch(() => [] as Variation[]) : Promise.resolve([] as Variation[]),
    money ? invoicesApi.list({ project_id: project.id }).catch(() => [] as Invoice[]) : Promise.resolve([] as Invoice[]),
    money ? paymentsApi.list({ project_id: project.id }).catch(() => []) : Promise.resolve([]),
  ])
  const paidByInvoice = new Map<string, number>()
  for (const p of payments) if (p.invoice_id) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount))
  return { templates: templates.filter((t) => t.active), docs, signing, company, contact, quotes, totals, variations, invoices, paidByInvoice }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function DocumentsTab({ project }: { project: Project }) {
  const access = useAccess()
  const money = seesMoney(access)
  const { currentUser } = useAuth()
  const { settings } = useBuild()
  const { data, error, loading, reload } = useLoad(() => load(project, money, seesQuotes(access)), [project.id, money], 'project-documents')
  const [making, setMaking] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [signing, setSigning] = useState<{ source: 'document' | 'quote' | 'variation'; id: string; title: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const clientName = data?.company?.name ?? (data?.contact ? contactName(data.contact) : '')
  const clientEmail = data?.contact?.email ?? data?.company?.email ?? null
  const clientPhone = data?.contact?.mobile ?? data?.contact?.phone ?? data?.company?.phone ?? null
  const writer = access !== 'read_only'

  if (loading && !data) return <Spinner />
  if (!data) return <ErrorBanner error={error ?? 'The documents could not be read.'} />
  const open = data.docs.find((d) => d.id === openId) ?? null

  const act = async (fn: () => Promise<unknown>) => {
    setActionError(null)
    try { await fn() } catch (e) { setActionError(errMsg(e)) }
  }

  return (
    <div className="space-y-4" data-testid="documents-tab">
      <ErrorBanner error={actionError ?? error} />
      <Card title="Documents" subtitle="Made from the Library for this job: contracts, site instructions, variation orders, letters." padded={false}
        actions={writer ? <Button variant="dark" size="sm" onClick={() => setMaking(true)} data-testid="new-document"><FilePlus2 size={14} /> New document</Button> : undefined}>
        {data.docs.length === 0 ? (
          <EmptyState title="No documents yet" icon={<FileText size={20} />}>
            {writer ? 'Press New document and pick a template from the Library: the job, the client and the quote fill it in.' : 'Nothing has been made for this job yet.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.docs.map((d) => {
              const req = latestFor(data.signing, (r) => r.document_id === d.id)
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => setOpenId(d.id)} data-testid="document-row"
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-slate-50">
                    <FileText size={16} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{d.title}</span>
                      <span className="block text-xs text-slate-500">{DOC_KIND[d.kind]?.label ?? d.kind} · {formatDate(d.created_at)}{d.sent_to ? ` · sent to ${d.sent_to}` : ''}</span>
                    </span>
                    <StatusChip doc={d} req={req} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {money && (data.quotes.length > 0 || data.variations.length > 0) && (
        <Card title="Sign online" subtitle="Send the quote or a variation to the client to sign from a link: no login, a finger or a mouse." padded={false}>
          <ul className="divide-y divide-slate-100">
            {data.quotes.map((q) => {
              const req = latestFor(data.signing, (r) => r.source === 'quote' && r.quote_id === q.id)
              const signable = q.status === 'draft' || q.status === 'sent'
              return (
                <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800">Quote {q.number ?? ''}</span> <span className="text-slate-500">{q.title}</span>
                    <span className="block text-xs text-slate-500">{[data.totals.get(q.id) ? formatZAR(data.totals.get(q.id)!.total_incl) : '', q.status, q.accepted_by_name ? `accepted by ${q.accepted_by_name}` : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                  {req && <RequestChip req={req} />}
                  {writer && signable && <Button size="sm" onClick={() => setSigning({ source: 'quote', id: q.id, title: `Quotation ${q.number ?? ''}`.trim() })}><PenLine size={13} /> Send for signing</Button>}
                </li>
              )
            })}
            {data.variations.map((v) => {
              const req = latestFor(data.signing, (r) => r.variation_id === v.id)
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800">Variation</span> <span className="text-slate-500">{v.description}</span>
                    <span className="block text-xs text-slate-500">{formatZAR(v.amount_excl)} excl. VAT · {formatDate(v.date)} · {v.approved ? 'approved' : 'not approved yet'}</span>
                  </span>
                  {req && <RequestChip req={req} />}
                  {writer && !v.approved && <Button size="sm" onClick={() => setSigning({ source: 'variation', id: v.id, title: `Variation order: ${v.description.slice(0, 60)}` })}><PenLine size={13} /> Send for signing</Button>}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {data.signing.length > 0 && (
        <Card title="Signing links" subtitle="Everything sent from this job to be signed online, newest first." padded={false}>
          <ul className="divide-y divide-slate-100" data-testid="signing-list">
            {data.signing.map((r) => {
              const st = signingStatus(r)
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm" data-testid="signing-row">
                  <FileSignature size={15} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{r.title}</span>
                    <span className="block text-xs text-slate-500">
                      {r.signer_name || r.signer_email || 'No name given'} · sent {formatDate(r.created_at)}
                      {r.opened_at ? ` · opened ${formatDateTime(r.opened_at)}` : ''}
                      {r.signed_at ? ` · signed ${formatDateTime(r.signed_at)} by ${r.signed_name}${r.signed_ip ? ` (${r.signed_ip})` : ''}` : ''}
                      {st === 'sent' || st === 'opened' ? ` · open until ${formatDate(r.expires_at)}` : ''}
                    </span>
                  </span>
                  <RequestChip req={r} />
                  {st === 'signed' && <Button size="sm" onClick={() => act(async () => showFile(await signedPdf(r.id)))}><Download size={13} /> Signed PDF</Button>}
                  {writer && (st === 'sent' || st === 'opened') && (
                    <Button size="sm" variant="ghost" title="Withdraw this link" onClick={() => { if (window.confirm('Withdraw this link? Whoever opens it is told it was withdrawn.')) void act(async () => { await cancelSigning(r.id); reload() }) }}><Ban size={13} /> Withdraw</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {making && (
        <NewDocumentModal project={project} data={data} clientName={clientName} senderName={currentUser?.name ?? ''} settings={settings}
          onClose={() => setMaking(false)} onMade={(d) => { setMaking(false); reload(); setOpenId(d.id) }} />
      )}
      {open && (
        <DocumentEditor doc={open} settings={settings} clientName={clientName} clientEmail={clientEmail} writer={writer}
          req={latestFor(data.signing, (r) => r.document_id === open.id)}
          onClose={() => setOpenId(null)} onChanged={reload}
          onSign={() => setSigning({ source: 'document', id: open.id, title: open.title })} />
      )}
      {signing && (
        <SendForSigningModal open onClose={() => { setSigning(null); reload() }} source={signing.source} id={signing.id} title={signing.title}
          defaultName={data.contact ? contactName(data.contact) : clientName} defaultEmail={clientEmail} phone={clientPhone}
          companyName={settings?.name} senderName={currentUser?.name} onDone={reload} />
      )}
    </div>
  )
}

function RequestChip({ req }: { req: SigningRequestRow }) {
  const s = SIGNING_STATUS[signingStatus(req)]
  return <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', s.tone)} data-testid="signing-status">{s.label}</span>
}

function StatusChip({ doc, req }: { doc: ProjectDocument; req: SigningRequestRow | null }) {
  if (req) return <RequestChip req={req} />
  const label = doc.status === 'draft' ? 'Draft' : doc.status === 'sent' ? 'Sent' : doc.status === 'signed' ? 'Signed' : 'Cancelled'
  return <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', doc.status === 'signed' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>{label}</span>
}

/* ------------------------------------------------------------------ making one */

function NewDocumentModal({ project, data, clientName, senderName, settings, onClose, onMade }: {
  project: Project
  data: Loaded
  clientName: string
  senderName: string
  settings: ReturnType<typeof useBuild>['settings']
  onClose: () => void
  onMade: (d: ProjectDocument) => void
}) {
  const access = useAccess()
  const offered = seesMoney(access) ? data.templates : data.templates.filter((t) => MONEY_FREE_KINDS.includes(t.kind))
  const [templateId, setTemplateId] = useState(offered[0]?.id ?? '')
  const [quoteId, setQuoteId] = useState(data.quotes[0]?.id ?? '')
  const [variationId, setVariationId] = useState(data.variations[0]?.id ?? '')
  const [invoiceId, setInvoiceId] = useState(data.invoices[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = offered.find((x) => x.id === templateId) ?? null
  const asks = t ? needs(t.body, t.subject) : { quote: false, variation: false, invoice: false }

  const filled = useMemo(() => {
    if (!t) return null
    const quote = data.quotes.find((q) => q.id === quoteId) ?? null
    const variation = data.variations.find((v) => v.id === variationId) ?? null
    const invoice = data.invoices.find((i) => i.id === invoiceId) ?? null
    const values = mergeValues({
      today: todayYmd(), senderName, company: settings,
      client: { name: clientName, address: data.contact?.address ?? data.company?.address, email: data.contact?.email ?? data.company?.email, phone: data.contact?.mobile ?? data.contact?.phone ?? data.company?.phone },
      project, quote, quoteTotals: quote ? data.totals.get(quote.id) ?? null : null,
      variation, invoice, invoicePaid: invoice ? data.paidByInvoice.get(invoice.id) ?? 0 : null,
    })
    return { body: renderTemplate(t.body, values), subject: renderTemplate(t.subject ?? '', values).text, quote, variation, invoice }
  }, [t, quoteId, variationId, invoiceId, data, clientName, senderName, settings, project])

  async function make() {
    if (!t || !filled) return setError('Pick a template.')
    setBusy(true)
    setError(null)
    try {
      const d = await createDocument({
        project_id: project.id, company_id: project.company_id, contact_id: project.contact_id,
        quote_id: asks.quote ? filled.quote?.id ?? null : null,
        variation_id: asks.variation ? filled.variation?.id ?? null : null,
        invoice_id: asks.invoice ? filled.invoice?.id ?? null : null,
        template_id: t.id, kind: t.kind, title: `${t.name}: ${project.name}`.slice(0, 200), subject: filled.subject || null,
        body: filled.body.text, signable: t.signable,
      })
      onMade(d)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="New document" wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={() => void make()} loading={busy} disabled={!t} data-testid="make-document"><FilePlus2 size={14} /> Make it</Button></>}>
      {offered.length === 0 ? (
        <EmptyState title="The Library is empty">An Administrator adds templates in the Library (in the sidebar).</EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-3">
            <Field label="Template">
              <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)} data-testid="template-pick">
                {offered.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            {asks.quote && (
              <Field label="Quote">
                <select className="input" value={quoteId} onChange={(e) => setQuoteId(e.target.value)}>
                  <option value="">None</option>
                  {data.quotes.map((q) => <option key={q.id} value={q.id}>{q.number ?? ''} {q.title}</option>)}
                </select>
              </Field>
            )}
            {asks.variation && (
              <Field label="Variation">
                <select className="input" value={variationId} onChange={(e) => setVariationId(e.target.value)}>
                  <option value="">None</option>
                  {data.variations.map((v) => <option key={v.id} value={v.id}>{v.description.slice(0, 50)} ({formatZAR(v.amount_excl)})</option>)}
                </select>
              </Field>
            )}
            {asks.invoice && (
              <Field label="Invoice">
                <select className="input" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                  <option value="">None</option>
                  {data.invoices.map((i) => <option key={i.id} value={i.id}>{i.number ?? ''} · {formatDate(i.issue_date)}</option>)}
                </select>
              </Field>
            )}
            {filled && filled.body.missing.length > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="missing-fields">
                Remus does not know: {filled.body.missing.map(fieldLabel).join(', ')}. They are left as lines to fill in; type them in the document before it goes out.
              </p>
            )}
          </div>
          <div className="max-h-[60dvh] overflow-auto rounded-xl bg-slate-200/70 p-2 sm:p-3">
            {filled && <DocumentSheet company={settings} body={filled.body.text} signable={t?.signable} clientName={clientName} />}
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}

/* ------------------------------------------------------------------ editing, PDF, email, WhatsApp, signing */

function DocumentEditor({ doc, settings, clientName, clientEmail, writer, req, onClose, onChanged, onSign }: {
  doc: ProjectDocument
  settings: ReturnType<typeof useBuild>['settings']
  clientName: string
  clientEmail: string | null
  writer: boolean
  req: SigningRequestRow | null
  onClose: () => void
  onChanged: () => void
  onSign: () => void
}) {
  const [title, setTitle] = useState(doc.title)
  const [body, setBody] = useState(doc.body)
  const [signable, setSignable] = useState(doc.signable)
  const [view, setView] = useState<'edit' | 'preview'>('preview')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [mailing, setMailing] = useState(false)
  const dirty = title !== doc.title || body !== doc.body || signable !== doc.signable
  const locked = doc.status === 'signed'

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    setNote(null)
    try { await fn() } catch (e) { setError(errMsg(e)) } finally { setBusy(null) }
  }
  const save = async () => { if (dirty) { await updateDocument(doc.id, { title: title.trim() || doc.title, body, signable }); onChanged() } }

  return (
    <Modal open onClose={onClose} title={doc.title} wide
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {writer && !locked && <Button variant="danger" className="mr-auto" onClick={() => { if (window.confirm('Delete this document?')) void run('delete', async () => { await deleteDocument(doc.id); onChanged(); onClose() }) }}><Trash2 size={14} /> Delete</Button>}
          <Button onClick={() => { const w = window.open('', '_blank'); void run('pdf', async () => { try { await save(); showFile(await documentPdf(doc.id), w) } catch (e) { w?.close(); throw e } }) }} loading={busy === 'pdf'}><Download size={14} /> PDF</Button>
          {writer && <Button onClick={() => void run('wa', async () => {
            await save()
            const r = await shareFile(await documentPdf(doc.id), `${settings?.name ?? 'Urban Haus'}: ${title}`)
            if (r === 'downloaded') setNote('Saved as a PDF: attach it in WhatsApp (this device cannot share a file directly).')
          })} loading={busy === 'wa'}><MessageCircle size={14} /> WhatsApp</Button>}
          {writer && <Button onClick={() => void run('mail', async () => { await save(); setMailing(true) })} loading={busy === 'mail'}><Mail size={14} /> Email</Button>}
          {writer && signable && !locked && <Button onClick={() => void run('sign', async () => { await save(); onSign(); onClose() })} loading={busy === 'sign'}><PenLine size={14} /> Send for signing</Button>}
          {writer && !locked && <Button variant="dark" onClick={() => void run('save', save)} loading={busy === 'save'} disabled={!dirty}><Save size={14} /> Save</Button>}
        </div>
      }>
      <div className="space-y-3" data-testid="document-editor">
        {req && <p className="text-xs text-slate-500">Signing: <RequestChip req={req} /> {req.signed_at ? `signed by ${req.signed_name} on ${formatDateTime(req.signed_at)}` : req.opened_at ? `opened ${formatDateTime(req.opened_at)}` : `sent ${formatDate(req.created_at)}`}</p>}
        {locked && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Signed, so the words can no longer be changed. Make a new document for any change.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {(['preview', 'edit'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                className={clsx('rounded-md px-3 py-1 text-xs font-medium', view === v ? 'bg-ink-950 text-white' : 'text-slate-500 hover:text-slate-700')}>
                {v === 'edit' ? 'Edit the words' : 'On the letterhead'}
              </button>
            ))}
          </div>
          {writer && !locked && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={signable} onChange={(e) => setSignable(e.target.checked)} /> Has a place to sign
            </label>
          )}
        </div>
        {view === 'edit' && writer && !locked ? (
          <div className="space-y-2">
            <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="The words" hint={'"# " starts a heading, "## " a smaller one, "- " a bullet, **words** in bold. Lines of ______ are gaps to fill in.'}>
              <textarea className="input min-h-[50dvh] font-mono text-[12.5px] leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)} data-testid="document-body" />
            </Field>
          </div>
        ) : (
          <div className="max-h-[62dvh] overflow-auto rounded-xl bg-slate-200/70 p-2 sm:p-3">
            <DocumentSheet company={settings} body={body} signable={signable} clientName={clientName} />
          </div>
        )}
        {note && <p className="text-sm text-slate-600">{note}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      {mailing && <EmailModal doc={{ ...doc, title }} to={clientEmail} company={settings?.name ?? 'Urban Haus'} clientName={clientName} onClose={() => setMailing(false)} onSent={() => { setMailing(false); onChanged() }} />}
    </Modal>
  )
}

function EmailModal({ doc, to, company, clientName, onClose, onSent }: { doc: ProjectDocument; to: string | null; company: string; clientName: string; onClose: () => void; onSent: () => void }) {
  const { currentUser } = useAuth()
  const [addr, setAddr] = useState(to ?? '')
  const [subject, setSubject] = useState(doc.subject || doc.title)
  const [message, setMessage] = useState(`Good day${clientName ? ` ${clientName.split(' ')[0]}` : ''},\n\nPlease find attached: ${doc.title}.\n\nKind regards,\n${currentUser?.name ?? company}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function send() {
    const list = addr.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
    if (!list.length) return setError('Type an email address.')
    setBusy(true)
    setError(null)
    try {
      await emailDocument(doc.id, { to: list, subject, message })
      onSent()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title="Email the document"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={() => void send()} loading={busy}><Mail size={14} /> Send</Button></>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">The PDF on the letterhead is attached. It goes from your own mailbox with your signature (Settings → My email), as a quote does.</p>
        <Field label="To"><input className="input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="client@example.com" /></Field>
        <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><textarea className="input min-h-[140px]" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
