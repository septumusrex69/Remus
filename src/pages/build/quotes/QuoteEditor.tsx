import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  Mail,
  Pencil,
  Plus,
  Printer,
  ListPlus,
  Save,
  Search,
  ShoppingCart,
  ExternalLink,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import {
  convertQuoteToProject,
  duplicateQuote,
  listQuoteItems,
  listQuoteStages,
  subcontractors as subsApi,
  planProjectFromQuote,
  invoices as invoicesApi,
  clientAddress,
  loadClientDirectory,
  quoteAttachments,
  quotes as quotesApi,
  saveQuoteItems,
  saveQuoteStages,
  type ClientDirectory,
  type QuoteItemDraft,
} from '../../../lib/api'
import { formatDate, formatDateTime, formatPct, formatZAR, round2, todayYmd } from '../../../lib/format'
import {
  applyLineEdit, applyMarkup, approvalCurrent, defaultStage, lockedPriceLine, MAX_MARKUP_PCT, quoteTotals, quoteValidationError, scheduleStages,
  type EditableLine, type StagePlan,
} from '../../../lib/quoteMath'
import { QUOTE_FILES_BUCKET, supabase } from '../../../lib/supabase'
import { Button, Card, ErrorBanner, Field, PageHeader, Spinner, StatusBadge } from '../../../components/ui'
import { DictateButton } from '../../../components/ui/Dictate'
import { RowMenu } from '../../../components/ui/RowMenu'
import { NumInput } from '../../../components/ui/NumInput'
import { LABOUR_GRADES, LINE_KINDS, QUOTE_STATUSES, UNITS, type CompanySettings, type LabourGrade, type LineKind, type Subcontractor, type SubRateUnit, type Quote, type QuoteAttachment, type QuoteStatus, type Unit } from '../../../types'
import { useAuth } from '../../../store/AuthContext'
import { ClientPicker } from '../components/ClientPicker'
import { paths } from '../paths'
import { useBuild } from '../BuildContext'
import { QuoteAttachmentsPanel } from './QuoteAttachmentsPanel'
import { SendQuoteModal } from './SendQuoteModal'
import { QuotePlanCard } from './QuotePlan'
import { AcceptQuoteModal } from './AcceptQuoteModal'
import { PdfMenu } from './PdfMenu'
import { FindPricesModal } from './FindPricesModal'
import { ShoppingListModal } from './ShoppingListModal'
import { SubcontractorModal, rateLabel } from '../subcontractors/SubcontractorsPage'

type Line = QuoteItemDraft & EditableLine & { key: string }

let keySeq = 0
const newKey = () => `l${++keySeq}`

const KIND_LABEL: Record<LineKind, string> = { material: 'Material', labour: 'Labour', subcontractor: 'Subcontractor' }
const KIND_TAG: Record<LineKind, string> = { material: 'MAT', labour: 'LAB', subcontractor: 'SUB' }
const KIND_TONE: Record<LineKind, string> = {
  material: 'bg-slate-100 text-slate-600',
  labour: 'bg-brand-50 text-brand-700',
  subcontractor: 'bg-emerald-50 text-emerald-700',
}

/** Default markup for a kind of line, from Settings → Quotes & Invoices. */
function kindMarkup(kind: LineKind, s: CompanySettings | null | undefined): number {
  if (!s) return 20
  return Number(kind === 'labour' ? s.markup_labour : kind === 'subcontractor' ? s.markup_subcontractor : s.markup_material)
}

const dayRate = (grade: LabourGrade, s: CompanySettings | null | undefined) =>
  Number((grade === 'junior' ? s?.labour_day_rate_junior : s?.labour_day_rate_senior) ?? 0)

/**
 * A new line. Labour is counted in worker-days at the senior rate, starting from the stage's
 * length (one worker for the whole stage); change the days or the grade on the line.
 */
function blankLine(section: string | null, kind: LineKind, s: CompanySettings | null | undefined, days = 1): Line {
  const markup = kindMarkup(kind, s)
  const base: Line = {
    key: newKey(), sort_order: 0, section, description: '', details: null, kind, labour_grade: null, subcontractor_id: null,
    unit: 'each', quantity: 1, unit_cost: 0, markup_pct: markup, unit_price: 0,
    buy_store: null, buy_code: null, buy_product: null, buy_url: null, buy_price: null, buy_checked_on: null,
  }
  if (kind !== 'labour') return base
  return applyLineEdit(
    { ...base, description: 'Labour (senior)', labour_grade: 'senior', unit: 'day', quantity: Math.max(1, days) },
    { unit_cost: dayRate('senior', s) },
  )
}

const stageKey = (section: string | null) => section ?? ''

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

const hasContent = (l: Line) => Boolean(l.description.trim() || l.details?.trim() || Number(l.unit_price) || Number(l.unit_cost))

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
  /** Lines whose details box was opened by hand; a line that already has details always shows it. */
  const [detailsOpen, setDetailsOpen] = useState<Set<string>>(new Set())
  // Material lines whose "buy at" row was opened by hand (a line that has a store shows it anyway).
  const [buyOpen, setBuyOpen] = useState<Set<string>>(new Set())
  /** Each section's plan, by section name ('' = General). A section with none uses defaultStage. */
  const [stagePlans, setStagePlans] = useState<Map<string, StagePlan>>(new Map())
  const { currentUser } = useAuth()
  /** The subcontractor list, for picking who does a subcontractor line. */
  const [subs, setSubs] = useState<Subcontractor[]>([])
  /** The line asking for a new subcontractor (opens the form), if any. */
  const [newSubFor, setNewSubFor] = useState<string | null>(null)
  // The material line whose cost is being looked up in the stores (FindPricesModal).
  const [findFor, setFindFor] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [shopping, setShopping] = useState(false)
  /** Sections folded down to their summary line, by section name ('' = General). */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    subsApi.list().then(setSubs).catch(() => {})
  }, [])
  const canApprove = currentUser?.role === 'Administrator'

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([quotesApi.get(id), listQuoteItems(id), loadClientDirectory(), quoteAttachments.list({ quote_id: id }), listQuoteStages(id)])
      .then(([q, items, d, att, st]) => {
        if (!active) return
        setQuote(q)
        setStagePlans(new Map(st.map((s) => [s.name, s])))
        setLines(items.map((i) => ({ ...lockedPriceLine(i), key: newKey() })))
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

  const totals = useMemo(
    () => quoteTotals(lines, quote?.discount ?? 0, quote?.vat_rate ?? 15, quote?.management_fee_pct ?? 0),
    [lines, quote?.discount, quote?.vat_rate, quote?.management_fee_pct],
  )
  const groups = useMemo(() => groupBySection(lines), [lines])
  /** The sections as stages, in order, with what is saved for each (or the default). */
  const plans = useMemo(
    () => groups.map((g, i) => ({ ...(stagePlans.get(stageKey(g.section)) ?? defaultStage(stageKey(g.section), i === 0)), name: stageKey(g.section) })),
    [groups, stagePlans],
  )
  const schedule = useMemo(() => scheduleStages(plans), [plans])

  if (loading) return <Spinner page />
  if (!quote) return <ErrorBanner error={error ?? 'Quote not found'} />

  const showDetails = (l: Line) => Boolean(l.details?.trim()) || detailsOpen.has(l.key)
  const approved = approvalCurrent(quote, totals.totalExcl)

  function updateStage(name: string, p: Partial<StagePlan>) {
    setStagePlans((m) => {
      const i = groups.findIndex((g) => stageKey(g.section) === name)
      const next = new Map(m)
      next.set(name, { ...(m.get(name) ?? defaultStage(name, i === 0)), ...p, name })
      return next
    })
    setDirty(true)
  }

  /** A subcontractor picked on a line: their usual rate becomes the cost, in the matching unit. */
  function pickSub(l: Line, s: Subcontractor) {
    const unit: Record<SubRateUnit, Unit> = { day: 'day', job: 'sum', hour: 'hours', 'm²': 'm²', each: 'each' }
    updateLine(l.key, {
      subcontractor_id: s.id,
      ...(s.rate_amount ? { unit_cost: Number(s.rate_amount), unit: unit[s.rate_unit] } : {}),
      ...(!l.description.trim() && s.trade ? { description: s.trade } : {}),
    })
  }

  /** A line's kind changed: labour is priced per worker-day by grade, the others start from their own markup. */
  function changeKind(l: Line, kind: LineKind) {
    if (kind === l.kind) return
    if (kind === 'labour') {
      const days = schedule.stages.find((s) => s.name === stageKey(l.section || null))?.duration_days ?? 1
      updateLine(l.key, {
        kind, labour_grade: 'senior', unit: 'day', quantity: l.unit === 'day' ? l.quantity : Math.max(1, days),
        unit_cost: dayRate('senior', settings), markup_pct: kindMarkup('labour', settings),
      })
    } else {
      updateLine(l.key, { kind, labour_grade: null, ...(l.kind === 'labour' ? { unit: 'each' as Unit, markup_pct: kindMarkup(kind, settings) } : {}) })
    }
  }

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

  function addLine(section: string | null, kind: LineKind = 'material') {
    const days = schedule.stages.find((s) => s.name === stageKey(section))?.duration_days ?? 1
    setLines((ls) => {
      // Insert after the last line of this section so groups stay together.
      let idx = -1
      ls.forEach((l, i) => (l.section || null) === section && (idx = i))
      const copy = [...ls]
      copy.splice(idx < 0 ? copy.length : idx + 1, 0, blankLine(section, kind, settings, days))
      return copy
    })
    setDirty(true)
  }

  function addSection() {
    const name = window.prompt('Section name (e.g. Foundations, Brickwork, Roofing)')
    if (!name?.trim()) return
    setLines((ls) => [...ls, blankLine(name.trim(), 'material', settings)])
    setDirty(true)
  }

  function renameSection(oldName: string | null, typed: string) {
    const newName = typed.trim() || null
    if (newName === oldName) return
    // Two sections with one name would become one; say so rather than merging them silently.
    if (groups.some((g) => g.section === newName)) {
      setError(`There is already a section called "${newName ?? 'General'}". Pick another name.`)
      return
    }
    setLines((ls) => ls.map((l) => ((l.section || null) === oldName ? { ...l, section: newName } : l)))
    // The stage's plan, and any stage that starts off it, follow the new name.
    const from = stageKey(oldName)
    const to = stageKey(newName)
    setStagePlans((m) => {
      const next = new Map<string, StagePlan>()
      for (const [k, v] of m) {
        const moved = { ...v, start_ref: v.start_ref === from ? to : v.start_ref }
        next.set(k === from ? to : k, k === from ? { ...moved, name: to } : moved)
      }
      return next
    })
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
    const v = window.prompt('Markup % to apply to every line', String(kindMarkup('material', settings)))
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
    const invalid = quoteValidationError(keep, Number(quote.discount || 0), Number(quote.vat_rate || 0), Number(quote.management_fee_pct || 0))
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
        scope: quote.scope?.trim() || null,
        notes: quote.notes,
        terms: quote.terms,
        discount: Number(quote.discount || 0),
        vat_rate: Number(quote.vat_rate || 0),
        management_fee_pct: Number(quote.management_fee_pct || 0),
        deposit_pct: Math.min(100, Math.max(0, Number(quote.deposit_pct ?? 50))),
        show_plan: quote.show_plan ?? true,
        updated_at: now,
      })
      const items = await saveQuoteItems(quote.id, keep)
      // Stages for the sections that are left after saving (an emptied section goes).
      const left = new Set(keep.map((l) => stageKey(l.section || null)))
      await saveQuoteStages(quote.id, plans.filter((p) => left.has(p.name)).map((p) => ({ ...p, start_ref: p.start_ref !== null && left.has(p.start_ref) ? p.start_ref : null })))
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

  /** The internal sign-off, at today's total excl. VAT. Saves first so it approves what is on screen. */
  async function approve() {
    if (!quote || !currentUser) return
    setBusy('approve')
    setError(null)
    try {
      if (dirty && !(await save())) return
      const saved = await quotesApi.update(quote.id, { approved_at: new Date().toISOString(), approved_by: currentUser.id, approved_total: totals.totalExcl })
      setQuote(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  /** Sending (or marking sent) waits for the approval. */
  function needsApproval(): boolean {
    if (approved) return false
    setError(canApprove ? 'Approve the quote first (Totals → Approve), then send it.' : 'This quote needs an Administrator to approve it before it is sent.')
    return true
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
    const hasValue = lines.some((l) => l.description.trim() && Number(l.quantity) * Number(l.unit_price) > 0)
    if (!hasValue && !window.confirm('This quote has no priced line items, so the project will start with a contract value and budget of R 0. Convert anyway?')) return
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
            {/* Print and PDF save first, so they always show what is on the screen. */}
            <Button onClick={async () => { if (!dirty || (await save())) navigate(paths.quotePrint(quote.id)) }}>
              <Printer size={15} /> Print
            </Button>
            <PdfMenu quoteId={quote.id} beforeBuild={async () => (dirty ? save() : true)} onError={setError} />
            {/* Internal: where to buy each material (ShoppingListModal). */}
            <Button onClick={() => setShopping(true)}>
              <ShoppingCart size={15} /> Shopping list
            </Button>
            <Button onClick={() => !needsApproval() && setSending(true)}>
              <Mail size={15} /> Send to client
            </Button>
          </>
        }
      />
      <ErrorBanner error={error} />

      <div className="mb-4 flex flex-wrap gap-2">
        {quote.status === 'draft' && (
          <Button size="sm" onClick={() => !needsApproval() && setStatus('sent')} loading={busy === 'sent'}><Send size={13} /> Mark sent</Button>
        )}
        {(quote.status === 'sent' || quote.status === 'draft') && (
          <>
            <Button size="sm" onClick={() => setAccepting(true)} loading={busy === 'accepted'}><Check size={13} /> Accepted</Button>
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
                  onChange={(v, address) => {
                    // Fill the site from the client's address unless someone typed a different one.
                    const site = (quote.site_address ?? '').trim()
                    const fromPrevious = site === '' || site === (clientAddress(dir, quote) ?? '')
                    patchQuote(fromPrevious && address ? { ...v, site_address: address } : v)
                  }}
                  onCreated={() => loadClientDirectory().then(setDir)}
                />
              </div>
              <Field
                label="Site address"
                className="sm:col-span-2"
                hint={quote.site_address && quote.site_address.trim() === clientAddress(dir, quote) ? "From the client's address. Change it if the site is elsewhere." : undefined}
              >
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

          <Card title="Scope of work" subtitle="A short summary of the job, shown on the quote above the line items.">
            <textarea
              className="input min-h-24"
              value={quote.scope ?? ''}
              onChange={(e) => patchQuote({ scope: e.target.value })}
              placeholder="e.g. Full renovation of the main bathroom: strip out the existing suite and tiles, re-plumb, tile floor and walls, and install a new toilet, basin and shower."
              aria-label="Scope of work"
            />
            <div className="mt-2">
              <DictateButton size="small" value={quote.scope ?? ''} onChange={(next) => patchQuote({ scope: next })} />
            </div>
          </Card>

          <Card
            title="Line items"
            padded={false}
            actions={
              <>
                {groups.length > 1 && (
                  <Button size="sm" variant="ghost" onClick={() => setCollapsed(collapsed.size >= groups.length ? new Set() : new Set(groups.map((g) => stageKey(g.section))))}>
                    {collapsed.size >= groups.length ? 'Open all' : 'Fold all'}
                  </Button>
                )}
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
            {/*
              Kept simple on purpose (Stephan, 26 Oct: "this all looks very confusing"): pricing only.
              Planning (days, when a stage starts) lives in the Plan card beside its timeline; the
              price per unit sits under the line total instead of a column of its own; move and
              delete are in the line's ⋯ menu; column titles appear once.

              Sized by the card's own width, not the screen's. Wide card: one row per line. Medium
              (an iPad): the description on its own row, the numbers under it. Phone: two columns.
            */}
            {/*
              Each section is a card of its own (Stephan, 26 Oct: "I can't distinguish between the two
              things... one thing should be a card"), and folds down to a one-line summary once done.
            */}
            <div className="@container space-y-3 bg-slate-50/60 p-3">
            {groups.map((g) => {
              const sectionTotal = g.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0)
              const key = stageKey(g.section)
              const folded = collapsed.has(key)
              const days = schedule.stages.find((s) => s.name === key)?.duration_days ?? 0
              const priced = g.lines.filter((l) => l.description.trim() || Number(l.unit_price)).length
              return (
                <section key={g.section ?? '__none'} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className={`flex items-center gap-2 px-3 py-2.5 ${folded ? '' : 'border-b border-slate-100 bg-slate-50'}`}>
                    <button
                      type="button"
                      className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })}
                      aria-label={folded ? 'Open section' : 'Fold section'}
                      title={folded ? 'Open' : 'Fold away'}
                    >
                      {folded ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                    </button>
                    {folded ? (
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setCollapsed((s) => { const n = new Set(s); n.delete(key); return n })}>
                        <span className="block truncate text-sm font-semibold text-slate-800">{g.section ?? 'General'}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {priced} line{priced === 1 ? '' : 's'}{days ? ` · ${days} working day${days === 1 ? '' : 's'}` : ''}
                          {g.lines.some((l) => l.kind === 'labour') ? ' · labour' : ''}{g.lines.some((l) => l.kind === 'subcontractor') ? ' · subcontractor' : ''}
                        </span>
                      </button>
                    ) : (
                      <SectionName name={g.section} onRename={(next) => renameSection(g.section, next)} />
                    )}
                    <span className="tabular shrink-0 text-sm font-semibold text-slate-700">{formatZAR(sectionTotal)}</span>
                    <button className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => removeSection(g.section)} aria-label="Delete section" title="Delete section"><Trash2 size={14} /></button>
                  </div>
                  {!folded && (
                  <>
                  <div className="hidden grid-cols-[88px_64px_96px_64px_1fr_36px] gap-2 px-4 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 @lg:grid @3xl:hidden">
                    <span>Unit</span><span className="text-right">Qty</span><span className="text-right">Cost</span><span className="text-right">Markup</span><span className="text-right">Total</span><span />
                  </div>
                  <div className="hidden grid-cols-[1fr_88px_64px_96px_64px_120px_36px] gap-2 px-4 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 @3xl:grid">
                    <span>Description</span><span>Unit</span><span className="text-right">Qty</span><span className="text-right">Cost</span><span className="text-right">Markup %</span><span className="text-right">Total</span><span />
                  </div>
                  {g.lines.map((l) => {
                    const lineTotal = round2(Number(l.quantity) * Number(l.unit_price))
                    return (
                    <div key={l.key} className="grid grid-cols-2 gap-2 border-t border-slate-100 px-4 py-2.5 first:border-t-0 @lg:grid-cols-[88px_64px_96px_64px_1fr_36px] @lg:items-center @3xl:grid-cols-[1fr_88px_64px_96px_64px_120px_36px]">
                      <div className="relative col-span-2 @lg:col-span-full @3xl:col-span-1">
                        <input className={`input pl-14 ${(l.kind ?? 'material') === 'material' && !showDetails(l) ? 'pr-16' : 'pr-9'}`} placeholder="Description, e.g. Toilet" value={l.description} onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                        {/* FIND PRICES (Remus · Handoff 1): look the material up in the stores and take its cost. */}
                        {(l.kind ?? 'material') === 'material' && (
                          <button
                            type="button"
                            className={`absolute inset-y-0 my-auto h-7 rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-700 ${showDetails(l) ? 'right-1' : 'right-8'}`}
                            onClick={() => setFindFor(l.key)}
                            title="Find prices: look this up in the stores"
                            aria-label="Find prices"
                          >
                            <Search size={15} />
                          </button>
                        )}
                        {/* The kind of cost, as a small tag inside the box; tap it to change. */}
                        <span className={`pointer-events-none absolute inset-y-0 left-1.5 my-auto flex h-6 w-11 items-center justify-center rounded text-[10px] font-semibold tracking-wide ${KIND_TONE[l.kind ?? 'material']}`}>
                          {KIND_TAG[l.kind ?? 'material']}
                        </span>
                        <select
                          className="absolute inset-y-0 left-1.5 my-auto h-6 w-11 cursor-pointer opacity-0"
                          value={l.kind ?? 'material'}
                          onChange={(e) => changeKind(l, e.target.value as LineKind)}
                          title={`${KIND_LABEL[l.kind ?? 'material']}: tap to change`}
                          aria-label="Kind of cost"
                        >
                          {LINE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                        </select>
                        {!showDetails(l) && (
                          <button
                            type="button"
                            className="absolute inset-y-0 right-1 my-auto h-7 rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-700"
                            onClick={() => setDetailsOpen((s) => new Set(s).add(l.key))}
                            title="Add details: what this line includes"
                            aria-label="Add details"
                          >
                            <ListPlus size={15} />
                          </button>
                        )}
                      </div>
                      <label className="@lg:contents">
                        <span className="label @lg:hidden">{l.kind === 'labour' ? 'Senior or junior' : 'Unit'}</span>
                      {l.kind === 'labour' ? (
                        // Labour: priced per worker-day; the grade sets the day rate.
                        <select
                          className="input px-1"
                          value={l.labour_grade ?? 'senior'}
                          onChange={(e) => {
                            const grade = e.target.value as LabourGrade
                            const renamed = /^Labour \((senior|junior)\)$/.test(l.description) || !l.description.trim()
                            updateLine(l.key, { labour_grade: grade, unit: 'day', unit_cost: dayRate(grade, settings), ...(renamed ? { description: `Labour (${grade})` } : {}) })
                          }}
                          aria-label="Senior or junior"
                        >
                          {LABOUR_GRADES.map((gr) => <option key={gr} value={gr}>{gr === 'senior' ? 'Senior' : 'Junior'}</option>)}
                        </select>
                      ) : (
                        <select className="input px-1" value={l.unit} onChange={(e) => updateLine(l.key, { unit: e.target.value as Unit })} aria-label="Unit">
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      )}
                      </label>
                      <label className="@lg:contents">
                        <span className="label @lg:hidden">{l.kind === 'labour' ? 'Worker-days' : 'Quantity'}</span>
                      <NumInput
                        className="text-right"
                        aria-label={l.kind === 'labour' ? 'Worker-days' : 'Quantity'}
                        title={l.kind === 'labour' ? 'Worker-days: 2 workers for 3 days is 6' : undefined}
                        value={l.quantity}
                        onValue={(n) => updateLine(l.key, { quantity: n })}
                      />
                      </label>
                      <label className="@lg:contents">
                        <span className="label @lg:hidden">Cost per unit</span>
                        <NumInput prefix="R" className="text-right" aria-label="Cost per unit" value={l.unit_cost} onValue={(n) => updateLine(l.key, { unit_cost: n })} />
                      </label>
                      <label className="@lg:contents">
                        <span className="label @lg:hidden">Markup %</span>
                        <NumInput suffix="%" className="text-right" aria-label="Markup %" value={l.markup_pct} onValue={(n) => updateLine(l.key, { markup_pct: n })} />
                      </label>
                      {/* The total, and under it the price per unit (cost plus markup; never typed). */}
                      <span className="self-center text-right">
                        <span className="tabular block text-sm font-semibold text-slate-800">{formatZAR(lineTotal)}</span>
                        {Number(l.quantity) !== 1 && Number(l.unit_price) > 0 && (
                          <span className="tabular block text-[11px] text-slate-400">{formatZAR(l.unit_price)} {l.kind === 'labour' ? 'a day' : 'each'}</span>
                        )}
                      </span>
                      <span className="flex justify-end self-center">
                        <RowMenu
                          width="w-44"
                          label="More for this line"
                          items={[
                            ...((l.kind ?? 'material') === 'material' ? [
                              { label: 'Find prices', icon: <Search size={14} />, onClick: () => setFindFor(l.key) },
                              { label: 'Where to buy', icon: <ShoppingCart size={14} />, onClick: () => setBuyOpen((s) => new Set(s).add(l.key)) },
                            ] : []),
                            ...(!showDetails(l) ? [{ label: 'Add details', icon: <ListPlus size={14} />, onClick: () => setDetailsOpen((s) => new Set(s).add(l.key)) }] : []),
                            { label: 'Move up', icon: <ArrowUp size={14} />, onClick: () => moveLine(l.key, -1) },
                            { label: 'Move down', icon: <ArrowDown size={14} />, onClick: () => moveLine(l.key, 1) },
                            { label: 'Delete line', icon: <Trash2 size={14} />, danger: true, onClick: () => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true) } },
                          ]}
                        />
                      </span>
                      {l.kind === 'subcontractor' && (
                        // Who does it. Internal: the client sees only the description, at our price.
                        <div className="col-span-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 @lg:col-span-full">
                          <span>Done by</span>
                          <select
                            className="input w-auto max-w-[18rem] px-1.5 py-1 text-xs"
                            value={l.subcontractor_id ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v === '__new') { setNewSubFor(l.key); return }
                              const s = subs.find((x) => x.id === v)
                              if (s) pickSub(l, s)
                              else updateLine(l.key, { subcontractor_id: null })
                            }}
                            aria-label="Subcontractor"
                          >
                            <option value="">Choose a subcontractor…</option>
                            {subs.filter((s) => s.active || s.id === l.subcontractor_id).map((s) => (
                              <option key={s.id} value={s.id}>{s.name}{s.trade ? ` (${s.trade})` : ''}{s.rate_amount ? ` · ${rateLabel(s)}` : ''}</option>
                            ))}
                            <option value="__new">+ New subcontractor…</option>
                          </select>
                          <span className="text-slate-400">Only you see this.</span>
                        </div>
                      )}
                      {/*
                        WHERE TO BUY IT (migration 0020; Stephan: "which store ... the code ... the particulars of
                        the product"). Filled by Find prices' Use or typed; internal, read by the shopping list.
                      */}
                      {(l.kind ?? 'material') === 'material' && (l.buy_store || buyOpen.has(l.key)) && (
                        <div className="col-span-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 @lg:col-span-full">
                          <span className="inline-flex items-center gap-1 font-medium text-slate-600"><ShoppingCart size={13} /> Buy at</span>
                          <input className="input w-36 px-1.5 py-1 text-xs" placeholder="Store, e.g. Leroy Merlin" aria-label="Store"
                            value={l.buy_store ?? ''} onChange={(e) => updateLine(l.key, { buy_store: e.target.value })} />
                          <input className="input w-24 px-1.5 py-1 font-mono text-xs" placeholder="Code" aria-label="Store's product code"
                            value={l.buy_code ?? ''} onChange={(e) => updateLine(l.key, { buy_code: e.target.value })} />
                          <input className="input min-w-[10rem] flex-1 px-1.5 py-1 text-xs" placeholder="Product, as the store names it" aria-label="Product"
                            value={l.buy_product ?? ''} onChange={(e) => updateLine(l.key, { buy_product: e.target.value })} />
                          <span className="w-28"><NumInput allowEmpty prefix="R" className="px-1.5 py-1 text-right text-xs" aria-label="Store price"
                            value={l.buy_price} onValue={(n) => updateLine(l.key, { buy_price: n, buy_checked_on: n == null ? null : todayYmd() })} /></span>
                          {l.buy_url && <a href={l.buy_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-700 hover:underline">View <ExternalLink size={11} /></a>}
                          {l.buy_checked_on && <span className="text-slate-400">price seen {formatDate(l.buy_checked_on, 'd MMM')}</span>}
                          <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => {
                            updateLine(l.key, { buy_store: null, buy_code: null, buy_product: null, buy_url: null, buy_price: null, buy_checked_on: null })
                            setBuyOpen((s) => { const n = new Set(s); n.delete(l.key); return n })
                          }}>Clear</button>
                          <span className="text-slate-400">Only you see this.</span>
                        </div>
                      )}
                      {showDetails(l) && (
                        <div className="col-span-2 @lg:col-span-full">
                          <textarea
                            className="input min-h-14 text-sm"
                            placeholder="What this line includes, e.g. Remove old suite, supply and install new toilet, connect to existing waste and water supply."
                            value={l.details ?? ''}
                            onChange={(e) => {
                              // Stays open while you type, even if you clear it to start again.
                              if (!detailsOpen.has(l.key)) setDetailsOpen((s) => new Set(s).add(l.key))
                              updateLine(l.key, { details: e.target.value })
                            }}
                            aria-label="Details"
                            autoFocus={!l.details && detailsOpen.has(l.key)}
                          />
                          <div className="mt-1 flex flex-wrap items-center gap-3">
                            <DictateButton size="small" value={l.details ?? ''} onChange={(next) => updateLine(l.key, { details: next })} />
                            {/* Nothing typed: just close it. Something typed: it stays unless you remove it. */}
                            <button
                              type="button"
                              className={`text-xs ${l.details?.trim() ? 'text-slate-400 hover:text-red-600' : 'font-medium text-slate-500 hover:text-slate-800'}`}
                              onClick={() => {
                                if (l.details?.trim() && !window.confirm('Remove the details for this line?')) return
                                updateLine(l.key, { details: null })
                                setDetailsOpen((s) => { const n = new Set(s); n.delete(l.key); return n })
                              }}
                            >
                              {l.details?.trim() ? 'Remove details' : 'Hide'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    )
                  })}
                  <div className="border-t border-slate-100 px-4 py-2.5">
                    <button className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800" onClick={() => addLine(g.section, 'material')}>
                      <Plus size={14} /> Add line
                    </button>
                  </div>
                  </>
                  )}
                </section>
              )
            })}
            </div>
          </Card>

          <QuotePlanCard
            stages={schedule.stages}
            totalDays={schedule.totalDays}
            onChange={(name, p) => updateStage(name, p)}
            showOnQuote={quote.show_plan ?? true}
            onShowOnQuote={(v) => patchQuote({ show_plan: v })}
            disclaimer={settings?.plan_disclaimer ?? ''}
          />

          <Card title="Notes & terms">
            <div className="grid gap-3">
              <Field label="Notes (shown on quote)">
                <textarea className="input min-h-20" value={quote.notes ?? ''} onChange={(e) => patchQuote({ notes: e.target.value })} />
              </Field>
              <DictateButton size="small" value={quote.notes ?? ''} onChange={(next) => patchQuote({ notes: next })} />
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
              <div className="flex items-center gap-2">
                <dt className="flex-1 text-slate-500">Management fee</dt>
                <span className="w-20"><NumInput suffix="%" className="py-1 text-right" value={quote.management_fee_pct} onValue={(n) => patchQuote({ management_fee_pct: Math.min(100, Math.max(0, n)) })} aria-label="Management fee %" /></span>
                <dd className="w-28 text-right whitespace-nowrap">{formatZAR(totals.managementFee)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="flex-1 text-slate-500">Discount</dt>
                <span className="w-32"><NumInput prefix="R" className="py-1 text-right" value={quote.discount} onValue={(n) => patchQuote({ discount: Math.max(0, n) })} aria-label="Discount in rand" /></span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2"><dt className="text-slate-500">Total excl. VAT</dt><dd>{formatZAR(totals.totalExcl)}</dd></div>
              <div className="flex items-center gap-2">
                <dt className="flex-1 text-slate-500">VAT</dt>
                <span className="w-20"><NumInput suffix="%" className="py-1 text-right" value={quote.vat_rate} onValue={(n) => patchQuote({ vat_rate: Math.min(100, Math.max(0, n)) })} aria-label="VAT %" /></span>
                <dd className="w-28 text-right whitespace-nowrap">{formatZAR(totals.vat)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total</dt><dd>{formatZAR(totals.totalIncl)}</dd></div>
              <div className="flex items-center gap-2">
                <dt className="flex-1 text-slate-500">Deposit</dt>
                <span className="w-20"><NumInput suffix="%" className="py-1 text-right" value={quote.deposit_pct} onValue={(n) => patchQuote({ deposit_pct: Math.min(100, Math.max(0, n)) })} aria-label="Deposit %" /></span>
                <dd className="w-28 text-right whitespace-nowrap">{formatZAR(round2((totals.totalIncl * Number(quote.deposit_pct || 0)) / 100))}</dd>
              </div>
            </dl>
            {settings && !settings.vat_registered && Number(quote.vat_rate) > 0 && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                The company is not registered for VAT (Settings), but this quote charges {Number(quote.vat_rate)}%.{' '}
                <button className="font-medium underline" onClick={() => patchQuote({ vat_rate: 0 })}>Charge no VAT</button>
              </p>
            )}
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">Internal — not on quote</p>
              <div className="tabular space-y-1">
                <div className="flex justify-between"><span className="text-slate-500">Materials</span><span>{formatZAR(totals.costByKind.material)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Labour</span><span>{formatZAR(totals.costByKind.labour)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Subcontractors</span><span>{formatZAR(totals.costByKind.subcontractor)}</span></div>
                <div className="flex justify-between border-t border-slate-200 pt-1"><span className="text-slate-500">Total cost</span><span>{formatZAR(totals.estimatedCost)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Markup</span><span>{formatZAR(round2(totals.subtotal - totals.estimatedCost))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Management fee</span><span>{formatZAR(totals.managementFee)}</span></div>
                {totals.discount > 0 && <div className="flex justify-between"><span className="text-slate-500">Less discount</span><span>-{formatZAR(totals.discount)}</span></div>}
                <div className={`flex justify-between border-t border-slate-200 pt-1 font-semibold ${totals.margin < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  <span>Estimated profit</span><span>{formatZAR(totals.margin)} ({formatPct(totals.marginPct)})</span>
                </div>
                <div className="flex justify-between"><span className="text-slate-500">Job length</span><span>{schedule.totalDays} working day{schedule.totalDays === 1 ? '' : 's'}</span></div>
                {schedule.totalDays > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Profit per working day</span><span>{formatZAR(round2(totals.margin / schedule.totalDays))}</span></div>
                )}
              </div>
              <div className="mt-3 border-t border-slate-200 pt-3">
                {approved ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <BadgeCheck size={15} /> Approved{quote.approved_at ? ` ${formatDateTime(quote.approved_at)}` : ''} at {formatZAR(Number(quote.approved_total))}
                  </p>
                ) : (
                  <>
                    <p className="mb-2 text-xs text-slate-500">
                      {quote.approved_at ? 'The price changed since it was approved. ' : ''}Approve the numbers before the quote goes to the client.
                    </p>
                    {canApprove ? (
                      <Button size="sm" variant="primary" onClick={approve} loading={busy === 'approve'}><BadgeCheck size={14} /> Approve at {formatZAR(totals.totalExcl)}</Button>
                    ) : (
                      <p className="text-xs text-slate-500">An Administrator approves quotes.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <ShoppingListModal open={shopping} onClose={() => setShopping(false)} title={`${quote.number ?? 'Quote'}${quote.title ? ` ${quote.title}` : ''}`} lines={lines} />

      {findFor && (() => {
        const line = lines.find((x) => x.key === findFor)
        if (!line) return null
        return (
          <FindPricesModal
            key={findFor}
            open
            onClose={() => setFindFor(null)}
            initialQuery={line.description.slice(0, 80)}
            onPick={(hit) => updateLine(findFor, {
              unit_cost: hit.price,
              buy_store: hit.store, buy_code: hit.code, buy_product: hit.name, buy_url: hit.url,
              buy_price: hit.price, buy_checked_on: todayYmd(),
            })}
          />
        )
      })()}

      {newSubFor && (
        <SubcontractorModal
          initial={{ rate_unit: 'job', active: true }}
          onClose={() => setNewSubFor(null)}
          onSaved={(s) => {
            setSubs((list) => [...list, s].sort((a, b) => a.name.localeCompare(b.name)))
            const l = lines.find((x) => x.key === newSubFor)
            if (l) pickSub(l, s)
            setNewSubFor(null)
          }}
        />
      )}

      <AcceptQuoteModal
        open={accepting}
        onClose={() => setAccepting(false)}
        quote={quote}
        totals={totals}
        hasProject={Boolean(quote.project_id)}
        onConfirm={async ({ project, deposit, start }) => {
          setAccepting(false)
          await run('accepted', async () => {
            let projectId = quote.project_id
            if (project && !projectId) projectId = (await convertQuoteToProject(quote.id)).id
            else await quotesApi.update(quote.id, { status: 'accepted', updated_at: new Date().toISOString() })
            // The quote's stages on the calendar, from the chosen start date.
            if (projectId && start) await planProjectFromQuote(projectId, quote.id, start)
            const pct = Number(quote.deposit_pct || 0)
            if (deposit && pct > 0) {
              const excl = round2((totals.totalExcl * pct) / 100)
              await invoicesApi.create({
                project_id: projectId,
                company_id: quote.company_id,
                contact_id: quote.contact_id,
                issue_date: todayYmd(),
                description: `Deposit (${pct}%) on quote ${quote.number ?? ''}: ${quote.title}`.trim(),
                amount_excl: excl,
                vat: round2((excl * Number(quote.vat_rate || 0)) / 100),
                status: 'draft',
              })
            }
            if (projectId) navigate(paths.project(projectId, start ? 'plan' : deposit ? 'invoices' : undefined))
            else setQuote(await quotesApi.get(quote.id))
          })
        }}
      />

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

/**
 * A section's name, editable in place: it looks like a box with a pencil so it is plain that it can
 * be changed, and a tap only puts the cursor in it (it used to open a rename prompt by surprise).
 * The new name is applied when you leave the box or press Enter; Escape puts the old one back.
 */
function SectionName({ name, onRename }: { name: string | null; onRename: (next: string) => void }) {
  const [draft, setDraft] = useState(name ?? '')
  useEffect(() => setDraft(name ?? ''), [name])
  return (
    <label className="group flex min-w-0 flex-1 items-center gap-1.5">
      <Pencil size={13} className="shrink-0 text-slate-400 group-hover:text-brand-700" aria-hidden />
      <input
        className="min-w-0 max-w-xs flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-800 focus:border-brand-400 focus:outline-none"
        value={draft}
        placeholder="General"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            const el = e.currentTarget
            setDraft(name ?? '')
            requestAnimationFrame(() => el.blur())
          }
        }}
        aria-label="Section name"
        title="Section name: tap to change"
      />
    </label>
  )
}
