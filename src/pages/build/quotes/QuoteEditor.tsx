import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Copy,
  FolderPlus,
  Mail,
  Plus,
  Printer,
  FileDown,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import {
  convertQuoteToProject,
  duplicateQuote,
  listQuoteItems,
  loadClientDirectory,
  openQuotePdf,
  quoteAttachments,
  quotes as quotesApi,
  saveQuoteItems,
  type ClientDirectory,
  type QuoteItemDraft,
} from '../../../lib/api'
import { formatDateTime, formatPct, formatZAR, round2, todayYmd } from '../../../lib/format'
import { applyLineEdit, applyMarkup, MAX_MARKUP_PCT, quoteTotals, quoteValidationError, type EditableLine } from '../../../lib/quoteMath'
import { QUOTE_FILES_BUCKET, supabase } from '../../../lib/supabase'
import { Button, Card, ErrorBanner, Field, PageHeader, Spinner, StatusBadge } from '../../../components/ui'
import { QUOTE_STATUSES, UNITS, type Quote, type QuoteAttachment, type QuoteStatus, type Unit } from '../../../types'
import { ClientPicker } from '../components/ClientPicker'
import { paths } from '../paths'
import { useBuild } from '../BuildContext'
import { QuoteAttachmentsPanel } from './QuoteAttachmentsPanel'
import { SendQuoteModal } from './SendQuoteModal'

type Line = QuoteItemDraft & EditableLine & { key: string }

let keySeq = 0
const newKey = () => `l${++keySeq}`

function blankLine(section: string | null, markup: number): Line {
  return { key: newKey(), sort_order: 0, section, description: '', unit: 'each', quantity: 1, unit_cost: 0, markup_pct: markup, unit_price: 0 }
}

/** Sections in order of first appearance; lines with no section form an unnamed first group. */
function groupBySection(lines: Line[]): { section: string | null; lines: Line[] }[] {
  const groups: { section: string | null; lines: Line[] }[] = []
  for (const l of lines) {
    const s = l.section || null
    let g = groups.find((x) => x.section === s)
    if (!g) {
      g = { section: s, lines: [] }
      groups.push(g)
    }
    g.lines.push(l)
  }
  return groups
}

const hasContent = (l: Line) => Boolean(l.description.trim() || Number(l.unit_price) || Number(l.unit_cost))

/**
 * Lines worth saving: blank lines are dropped, except that a section with nothing in it yet keeps
 * its first (blank) line so the new section doesn't vanish on save. The print view skips it.
 */
function linesToSave(lines: Line[]): Line[] {
  return lines.filter((l, i) => {
    if (hasContent(l)) return true
    const s = l.section || null
    if (!s) return false
    return !lines.some((x) => (x.section || null) === s && hasContent(x)) && lines.findIndex((x) => (x.section || null) === s) === i
  })
}

const num = (v: string) => (v === '' ? 0 : Number(v))

export function QuoteEditor() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { settings } = useBuild()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [dir, setDir] = useState<ClientDirectory | null>(null)
  const [attachments, setAttachments] = useState<QuoteAttachment[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const defaultMarkup = 20

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([quotesApi.get(id), listQuoteItems(id), loadClientDirectory(), quoteAttachments.list({ quote_id: id })])
      .then(([q, items, d, att]) => {
        if (!active) return
        setQuote(q)
        setLines(items.map((i) => ({ ...i, key: newKey() })))
        setDir(d)
        setAttachments(att)
        setDirty(false)
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [id])

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const totals = useMemo(() => quoteTotals(lines, quote?.discount ?? 0, quote?.vat_rate ?? 15), [lines, quote?.discount, quote?.vat_rate])
  const groups = useMemo(() => groupBySection(lines), [lines])

  if (loading) return <Spinner />
  if (!quote) return <ErrorBanner error={error ?? 'Quote not found'} />

  const patchQuote = (p: Partial<Quote>) => {
    setQuote({ ...quote, ...p })
    setDirty(true)
  }

  function updateLine(key: string, p: Partial<Line>) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l
        return applyLineEdit(l, p)
      }),
    )
    setDirty(true)
  }

  function addLine(section: string | null) {
    setLines((ls) => {
      // Insert after the last line of this section so groups stay together.
      let idx = -1
      ls.forEach((l, i) => (l.section || null) === section && (idx = i))
      const copy = [...ls]
      copy.splice(idx < 0 ? copy.length : idx + 1, 0, blankLine(section, defaultMarkup))
      return copy
    })
    setDirty(true)
  }

  function addSection() {
    const name = window.prompt('Section name (e.g. Foundations, Brickwork, Roofing)')
    if (!name?.trim()) return
    setLines((ls) => [...ls, blankLine(name.trim(), defaultMarkup)])
    setDirty(true)
  }

  function renameSection(oldName: string | null) {
    const name = window.prompt('Rename section', oldName ?? '')
    if (name === null) return
    setLines((ls) => ls.map((l) => ((l.section || null) === oldName ? { ...l, section: name.trim() || null } : l)))
    setDirty(true)
  }

  function removeSection(section: string | null) {
    if (!window.confirm(`Delete section "${section ?? 'General'}" and its lines?`)) return
    setLines((ls) => ls.filter((l) => (l.section || null) !== section))
    setDirty(true)
  }

  function moveLine(key: string, dir: -1 | 1) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key)
      const section = ls[i].section || null
      let j = i + dir
      while (j >= 0 && j < ls.length && (ls[j].section || null) !== section) j += dir
      if (j < 0 || j >= ls.length) return ls
      const copy = [...ls]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
    setDirty(true)
  }

  function applyMarkupToAll() {
    const v = window.prompt('Markup % to apply to every line with a unit cost (lines priced by hand keep their price)', String(defaultMarkup))
    if (v === null || v.trim() === '') return
    const m = Number(v)
    if (!Number.isFinite(m) || Math.abs(m) > MAX_MARKUP_PCT) {
      setError(`Markup must be a number between -${MAX_MARKUP_PCT} and ${MAX_MARKUP_PCT}%.`)
      return
    }
    setError(null)
    setLines((ls) => ls.map((l) => applyMarkup(l, round2(m))))
    setDirty(true)
  }

  async function save(): Promise<boolean> {
    if (!quote) return false
    setError(null)
    const keep = linesToSave(lines)
    const invalid = quoteValidationError(keep, Number(quote.discount || 0), Number(quote.vat_rate || 0))
    if (invalid) {
      setError(invalid)
      return false
    }
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const saved = await quotesApi.update(quote.id, {
        title: quote.title,
        company_id: quote.company_id,
        contact_id: quote.contact_id,
        site_address: quote.site_address,
        status: quote.status,
        ...(quote.status === 'sent' && !quote.sent_at ? { sent_at: now } : {}),
        issue_date: quote.issue_date || todayYmd(),
        valid_until: quote.valid_until,
        notes: quote.notes,
        terms: quote.terms,
        discount: Number(quote.discount || 0),
        vat_rate: Number(quote.vat_rate || 0),
        updated_at: now,
      })
      const items = await saveQuoteItems(quote.id, keep)
      setQuote(saved)
      setLines(items.map((i) => ({ ...i, key: newKey() })))
      setDirty(false)
      setSavedAt(new Date().toISOString())
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(status: QuoteStatus) {
    if (!quote) return
    setBusy(status)
    setError(null)
    try {
      if (dirty && !(await save())) return
      const now = new Date().toISOString()
      const saved = await quotesApi.update(quote.id, { status, updated_at: now, ...(status === 'sent' && !quote.sent_at ? { sent_at: now } : {}) })
      setQuote(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setError(null)
    try {
      if (dirty && !(await save())) return
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function removeQuote() {
    if (!quote || !window.confirm('Delete this quote and its uploaded files?')) return
    setBusy('del')
    setError(null)
    try {
      // Storage objects first (the rows cascade with the quote, the files would not). No save needed.
      const files = await quoteAttachments.list({ quote_id: quote.id })
      if (files.length) {
        const { error: rmError } = await supabase.storage.from(QUOTE_FILES_BUCKET).remove(files.map((a) => a.file_path))
        if (rmError) throw new Error(`Could not delete the quote's files: ${rmError.message}`)
      }
      await quotesApi.remove(quote.id)
      setDirty(false)
      navigate(paths.quotes())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function convert() {
    if (quote?.status === 'declined' && !window.confirm('This quote was declined. Convert it to a project anyway? It will be marked accepted.')) return
    void run('convert', async () => navigate(paths.project((await convertQuoteToProject(quote!.id)).id)))
  }

  const clientEmail = (() => {
    if (!dir) return ''
    const contact = quote.contact_id ? dir.contactById.get(quote.contact_id) : null
    if (contact?.email) return contact.email
    const companyId = quote.company_id ?? contact?.company_id ?? null
    return (companyId && dir.companyById.get(companyId)?.email) || ''
  })()

  return (
    <div>
      <Link to={paths.quotes()} className="no-print mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={14} /> Quotes
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono text-base text-slate-400">{quote.number}</span> {quote.title || 'Untitled quote'}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={quote.status} />
            {quote.sent_at && <span className="text-xs">Sent {formatDateTime(quote.sent_at)} to {quote.sent_to}</span>}
            {dirty ? <span className="text-xs text-brand-700">Unsaved changes</span> : savedAt ? <span className="text-xs text-emerald-700">Saved</span> : null}
          </span>
        }
        actions={
          <>
            <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
              <Save size={15} /> Save
            </Button>
            <Link to={paths.quotePrint(quote.id)} onClick={(e) => dirty && !window.confirm('You have unsaved changes. Open the print view anyway?') && e.preventDefault()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">
              <Printer size={15} /> Print
            </Link>
            <Button
              onClick={() => {
                if (dirty && !window.confirm('You have unsaved changes. The PDF shows the last saved version. Continue?')) return
                openQuotePdf(quote.id).catch((e) => setError(e instanceof Error ? e.message : String(e)))
              }}
            >
              <FileDown size={15} /> PDF
            </Button>
            <Button onClick={() => setSending(true)}>
              <Mail size={15} /> Send to client
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />

      <div className="mb-4 flex flex-wrap gap-2">
        {quote.status === 'draft' && (
          <Button size="sm" onClick={() => setStatus('sent')} loading={busy === 'sent'}><Send size={13} /> Mark sent</Button>
        )}
        {(quote.status === 'sent' || quote.status === 'draft') && (
          <>
            <Button size="sm" onClick={() => setStatus('accepted')} loading={busy === 'accepted'}><Check size={13} /> Accepted</Button>
            <Button size="sm" onClick={() => setStatus('declined')} loading={busy === 'declined'}><X size={13} /> Declined</Button>
          </>
        )}
        <Button size="sm" onClick={() => run('dup', async () => navigate(paths.quote((await duplicateQuote(quote.id)).id)))} loading={busy === 'dup'}>
          <Copy size={13} /> Duplicate
        </Button>
        {quote.project_id ? (
          <Link to={paths.project(quote.project_id)} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800">
            <FolderPlus size={13} /> View project
          </Link>
        ) : (
          <Button size="sm" variant="dark" onClick={convert} loading={busy === 'convert'}>
            <FolderPlus size={13} /> Convert to project
          </Button>
        )}
        <Button
          size="sm"
          variant="danger"
          onClick={removeQuote}
          loading={busy === 'del'}
        >
          <Trash2 size={13} /> Delete
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Details">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title" className="sm:col-span-2">
                <input className="input" value={quote.title} onChange={(e) => patchQuote({ title: e.target.value })} placeholder="e.g. Double garage extension" />
              </Field>
              {/* Not a <Field>: a <label> around the picker would also wrap its "new client" modal. */}
              <div className="sm:col-span-2">
                <span className="label">Client</span>
                <ClientPicker
                  dir={dir}
                  value={{ company_id: quote.company_id, contact_id: quote.contact_id }}
                  onChange={(v) => patchQuote(v)}
                  onCreated={() => loadClientDirectory().then(setDir)}
                />
              </div>
              <Field label="Site address" className="sm:col-span-2">
                <input className="input" value={quote.site_address ?? ''} onChange={(e) => patchQuote({ site_address: e.target.value })} />
              </Field>
              <Field label="Issue date">
                <input type="date" className="input" value={quote.issue_date} onChange={(e) => patchQuote({ issue_date: e.target.value || todayYmd() })} />
              </Field>
              <Field label="Valid until">
                <input type="date" className="input" value={quote.valid_until ?? ''} onChange={(e) => patchQuote({ valid_until: e.target.value || null })} />
              </Field>
              <Field label="Status">
                <select className="input" value={quote.status} onChange={(e) => patchQuote({ status: e.target.value as QuoteStatus })}>
                  {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </Card>

          <Card
            title="Line items"
            padded={false}
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={applyMarkupToAll}>Set markup</Button>
                <Button size="sm" onClick={addSection}><Plus size={13} /> Section</Button>
              </>
            }
          >
            {lines.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">
                No lines yet.{' '}
                <button className="font-medium text-brand-700 underline" onClick={() => addLine(null)}>Add a line</button> or add a section.
              </div>
            )}
            {groups.map((g) => {
              const sectionTotal = g.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0)
              return (
                <div key={g.section ?? '__none'} className="border-b border-slate-100 last:border-0">
                  <div className="flex items-center justify-between bg-slate-50 px-4 py-2">
                    <button className="text-sm font-semibold text-slate-800 hover:text-brand-700" onClick={() => renameSection(g.section)} title="Rename section">
                      {g.section ?? 'General'}
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="tabular text-xs text-slate-500">{formatZAR(sectionTotal)}</span>
                      <button className="text-slate-400 hover:text-red-600" onClick={() => removeSection(g.section)} aria-label="Delete section"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="hidden grid-cols-[1fr_70px_70px_100px_70px_100px_100px_56px] gap-2 px-4 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 md:grid">
                    <span>Description</span><span>Unit</span><span className="text-right">Qty</span><span className="text-right">Unit cost</span>
                    <span className="text-right">Markup</span><span className="text-right">Unit price</span><span className="text-right">Line total</span><span />
                  </div>
                  {g.lines.map((l) => (
                    <div key={l.key} className="grid grid-cols-2 gap-2 border-t border-slate-50 px-4 py-2 md:grid-cols-[1fr_70px_70px_100px_70px_100px_100px_56px] md:items-center md:border-0">
                      <input className="input col-span-2 md:col-span-1" placeholder="Description" value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                      <select className="input px-1" value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value as Unit })} aria-label="Unit">
                        {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <input className="input text-right" type="number" inputMode="decimal" step="any" aria-label="Quantity" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: num(e.target.value) })} />
                      <label className="md:contents">
                        <span className="label md:hidden">Unit cost</span>
                        <input className="input text-right" type="number" inputMode="decimal" step="0.01" aria-label="Unit cost" value={l.unit_cost} onChange={(e) => updateLine(l.key, { unit_cost: num(e.target.value) })} />
                      </label>
                      <label className="md:contents">
                        <span className="label md:hidden">Markup %</span>
                        <input className="input text-right" type="number" inputMode="decimal" step="any" aria-label="Markup %" value={l.markup_pct} onChange={(e) => updateLine(l.key, { markup_pct: num(e.target.value) })} />
                      </label>
                      <label className="md:contents">
                        <span className="label md:hidden">Unit price</span>
                        <input className="input text-right font-medium" type="number" inputMode="decimal" step="0.01" aria-label="Unit price" value={l.unit_price} onChange={(e) => updateLine(l.key, { unit_price: num(e.target.value) })} />
                      </label>
                      <span className="tabular self-center text-right text-sm font-medium text-slate-800">{formatZAR(round2(Number(l.quantity) * Number(l.unit_price)))}</span>
                      <span className="flex items-center justify-end gap-0.5 self-center">
                        <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => moveLine(l.key, -1)} aria-label="Move up"><ArrowUp size={13} /></button>
                        <button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={() => moveLine(l.key, 1)} aria-label="Move down"><ArrowDown size={13} /></button>
                        <button className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true) }} aria-label="Delete line"><Trash2 size={13} /></button>
                      </span>
                    </div>
                  ))}
                  <div className="px-4 py-2">
                    <button className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800" onClick={() => addLine(g.section)}>
                      <Plus size={13} /> Add line
                    </button>
                  </div>
                </div>
              )
            })}
          </Card>

          <Card title="Notes & terms">
            <div className="grid gap-3">
              <Field label="Notes (shown on quote)">
                <textarea className="input min-h-20" value={quote.notes ?? ''} onChange={(e) => patchQuote({ notes: e.target.value })} />
              </Field>
              <Field label="Terms" hint={!quote.terms && settings?.quote_terms ? <button className="text-brand-700 underline" onClick={() => patchQuote({ terms: settings.quote_terms })}>Use default terms from settings</button> : undefined}>
                <textarea className="input min-h-28" value={quote.terms ?? ''} onChange={(e) => patchQuote({ terms: e.target.value })} />
              </Field>
            </div>
          </Card>

          <QuoteAttachmentsPanel quoteId={quote.id} attachments={attachments} onChange={setAttachments} />
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card title="Totals">
            <dl className="tabular space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatZAR(totals.subtotal)}</dd></div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Discount (R)</dt>
                <dd><input className="input w-32 py-1 text-right" type="number" inputMode="decimal" step="0.01" min="0" value={quote.discount} onChange={(e) => patchQuote({ discount: num(e.target.value) })} /></dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2"><dt className="text-slate-500">Total excl. VAT</dt><dd>{formatZAR(totals.totalExcl)}</dd></div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">VAT @ <input className="input inline w-16 px-1.5 py-0.5 text-right" type="number" step="0.01" min="0" max="100" value={quote.vat_rate} onChange={(e) => patchQuote({ vat_rate: num(e.target.value) })} />%</dt>
                <dd>{formatZAR(totals.vat)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total</dt><dd>{formatZAR(totals.totalIncl)}</dd></div>
            </dl>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Internal — not on quote</p>
              <div className="tabular flex justify-between"><span className="text-slate-500">Estimated cost</span><span>{formatZAR(totals.estimatedCost)}</span></div>
              <div className={`tabular flex justify-between font-medium ${totals.margin < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                <span>Estimated margin</span><span>{formatZAR(totals.margin)} ({formatPct(totals.marginPct)})</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <SendQuoteModal
        open={sending}
        onClose={() => setSending(false)}
        quote={quote}
        totals={totals}
        attachments={attachments}
        defaultTo={clientEmail}
        companyName={settings?.name ?? ''}
        beforeSend={async () => (dirty ? save() : true)}
        onSent={(q, opts) => {
          setQuote(q)
          if (!opts?.keepOpen) setSending(false)
        }}
      />
    </div>
  )
}
