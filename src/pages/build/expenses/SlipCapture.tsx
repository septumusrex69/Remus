import { useEffect, useRef, useState } from 'react'
import { seesMoney, useAccess } from '../../../lib/access'
import { StageSelect } from '../components/StageSelect'
import { NumInput } from '../../../components/ui/NumInput'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, FileText, Images, Loader2, Plus, Split, X } from 'lucide-react'
import { ProductAdvice } from '../products/ProductAdvice'
import { ProductForm } from '../products/ProductsPage'
import { productsApi } from '../../../lib/api'
import type { Product } from '../../../lib/products'
import { expenses as expensesApi, extractReceipt, projects as projectsApi, uploadReceipt } from '../../../lib/api'
import { RECEIPTS_BUCKET, supabase } from '../../../lib/supabase'
import { formatZAR, labelize, round2, todayYmd } from '../../../lib/format'
import { splitInclusive } from '../../../lib/quoteMath'
import { compressImage, inferFileType } from '../../../lib/image'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, Field, PageHeader } from '../../../components/ui'
import { EXPENSE_CATEGORIES, type ExpenseCategory, type Project, type ReceiptExtraction } from '../../../types'
import { ProjectSelect } from '../components/ProjectSelect'
import { JobOrOverhead, expenseFieldsFor, jobOrOverheadProblem, type SlipFor } from '../components/JobOrOverhead'
import { OVERHEAD_KINDS, guessOverheadKind } from '../../../lib/overheads'
import { paths } from '../paths'
import { useVatRate } from '../BuildContext'

type Stage = 'uploading' | 'reading' | 'review' | 'saving' | 'error'

const YMD = /^\d{4}-\d{2}-\d{2}$/

interface Slip {
  id: string
  file: File
  previewUrl: string
  path?: string
  stage: Stage
  extraction?: ReceiptExtraction | null
  aiNote?: string
  error?: string
}

interface FormState {
  supplier: string
  date: string
  receipt_number: string
  total_incl: string
  vat: string
  category: ExpenseCategory
  project_id: string | null
  stage_id: string | null
  description: string
  paid: boolean
  /** A job or overheads, and which kind of overhead (Remus · Handover 8, lib/overheads.ts). */
  for: SlipFor
  overhead_kind: string | null
}

/** One part of a split slip (Remus · Handover 6): where it goes, and how much of the slip, incl. VAT. */
interface Part {
  key: string
  project_id: string | null
  stage_id: string | null
  category: ExpenseCategory
  description: string
  amount: number | null
  /** A part on no job is an overhead: which kind. */
  overhead_kind?: string | null
}
const newPart = (p: Partial<Part> = {}): Part => ({ key: crypto.randomUUID(), project_id: null, stage_id: null, category: 'materials', description: '', amount: null, ...p })

/** The form's job-or-overheads part, as JobOrOverhead takes it. */
const placeOf = (f: FormState) => ({ for: f.for, project_id: f.project_id, stage_id: f.stage_id, category: f.category, overhead_kind: f.overhead_kind })

const blankForm = (projectId: string | null): FormState => ({
  supplier: '',
  date: todayYmd(),
  receipt_number: '',
  total_incl: '',
  vat: '',
  category: 'materials',
  project_id: projectId,
  stage_id: null,
  description: '',
  paid: true,
  for: 'job',
  overhead_kind: null,
})

/**
 * Snap slip → upload to the private 'receipts' bucket → Claude reads the figures off it → the person says which
 * project it is for, checks it beside the image → save as an expense. Works without AI: the form starts empty.
 *
 * Remus · Handover 7 (2 Nov 2026): Claude no longer guesses the project, and the "Tell Claude" box is gone.
 * Stephan: "I don't think it's necessary to try to find out which project it is for. That's unnecessary processing
 * power. Just ask which project is it for." Splitting a slip across projects is still here, by hand.
 */
export function SlipCapture() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Someone without the Expenses page (lib/access.ts) goes back to the dashboard when done.
  const back = seesMoney(useAccess()) ? paths.expenses() : paths.dashboard()
  const presetProject = params.get('project')
  const vatRate = useVatRate()
  const { data: projects } = useLoad(() => projectsApi.list(), [], 'projects-list')
  const [queue, setQueue] = useState<Slip[]>([])
  const [savedCount, setSavedCount] = useState(0)
  const [form, setForm] = useState<FormState>(blankForm(presetProject))
  const [suggested, setSuggested] = useState<Set<keyof FormState>>(new Set())
  /*
   * SPLIT ACROSS PROJECTS (Remus · Handover 6). Stephan: "R10,000 of cement, but R5,000 is for one project and
   * R5,000 for the other ... you should be able to split the slip." Null: the slip goes to
   * one place (the form below). Parts: one expense each, all on the same slip photo, VAT shared pro rata.
   */
  const [parts, setParts] = useState<Part[] | null>(null)
  /* The products book (Remus · Handover 6): each item on the slip checked against it, and added to it with one tap. */
  const { data: productBook, reload: reloadBook } = useLoad(() => productsApi.list().catch(() => [] as Product[]), [], 'products-book')
  const [addingProduct, setAddingProduct] = useState<{ name: string; price: number | null } | null>(null)
  const setPart = (key: string, patch: Partial<Part>) => setParts((ps) => ps && ps.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const cameraRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const current = queue[0]

  // Release any object URLs still held when leaving the page.
  const queueRef = useRef(queue)
  queueRef.current = queue
  useEffect(() => () => queueRef.current.forEach((s) => URL.revokeObjectURL(s.previewUrl)), [])

  // Read the latest projects / VAT rate when an extraction lands, not the values from when it started.
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const vatRateRef = useRef(vatRate)
  vatRateRef.current = vatRate

  // Slips whose upload/read is running (survives StrictMode's double effect run), and slips the
  // person has already discarded or skipped (their late uploads get cleaned up).
  const inFlight = useRef(new Set<string>())
  const removed = useRef(new Set<string>())

  const updateSlip = (id: string, patch: Partial<Slip>) => setQueue((q) => q.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const updateCurrent = (patch: Partial<Slip>) => {
    if (current) updateSlip(current.id, patch)
  }

  function addFiles(files: FileList | null) {
    if (!files?.length) return
    const slips = Array.from(files).map((file) => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), stage: 'uploading' as Stage }))
    setQueue((q) => [...q, ...slips])
  }

  // Process the head of the queue: upload, then read. Results are applied to the slip by id, so a
  // stage change on the head never cancels its own in-flight request.
  const headId = current?.id ?? ''
  const headStage = current?.stage
  useEffect(() => {
    const slip = queueRef.current[0]
    if (!slip || slip.id !== headId || headStage !== 'uploading' || inFlight.current.has(slip.id)) return
    const id = slip.id
    inFlight.current.add(id)
    ;(async () => {
      try {
        let path = slip.path
        if (!path) {
          path = await uploadReceipt(await compressImage(slip.file))
          if (removed.current.has(id)) {
            await supabase.storage.from(RECEIPTS_BUCKET).remove([path]).catch(() => {})
            return
          }
          updateSlip(id, { path, stage: 'reading' })
        } else {
          updateSlip(id, { stage: 'reading' })
        }
        const res = await extractReceipt(path)
        if (removed.current.has(id)) return
        const isHead = queueRef.current[0]?.id === id
        if (res.configured) {
          updateSlip(id, { stage: 'review', extraction: res.extraction })
          if (isHead) prefill(res.extraction)
        } else {
          updateSlip(id, { stage: 'review', extraction: null, aiNote: res.message })
          if (isHead) {
            setForm(blankForm(presetProject))
            setSuggested(new Set())
          }
        }
      } catch (e) {
        if (!removed.current.has(id)) updateSlip(id, { stage: 'error', error: e instanceof Error ? e.message : String(e) })
      } finally {
        inFlight.current.delete(id)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headId, headStage])

  function prefill(x: ReceiptExtraction) {
    const marks = new Set<keyof FormState>()
    const excl = x.amount_excl ?? null
    const total = x.total_incl ?? (excl !== null && x.vat !== null ? round2(excl + x.vat) : null)
    // Not registered for VAT (rate 0): the slip's VAT is part of the cost, so none is split out.
    const vat = vatRateRef.current === 0 ? (total !== null ? 0 : null) : x.vat ?? (total !== null ? splitInclusive(total, vatRateRef.current).vat : null)
    const f = blankForm(presetProject)
    for (const [k, v] of [['supplier', x.supplier], ['receipt_number', x.slip_number]] as const) if (v) { f[k] = v; marks.add(k) }
    if (x.date && YMD.test(x.date)) { f.date = x.date; marks.add('date') }
    if (total !== null) { f.total_incl = String(total); marks.add('total_incl') }
    if (vat !== null) f.vat = String(vat)
    if (x.line_items?.length) f.description = x.line_items.slice(0, 4).map((l) => l.description).join(', ').slice(0, 200)
    // Handwriting says what it was for, better than the items do ("Nancy Rubble Removal" on a card slip).
    if (x.note) { f.description = x.note.slice(0, 200); marks.add('description') }
    // A fuel station, a cellphone network, a tyre centre: overheads of that kind, as a suggestion (lib/overheads.ts).
    const kind = presetProject ? null : guessOverheadKind(x.supplier, ...(x.line_items ?? []).slice(0, 4).map((l) => l.description))
    if (kind) { f.for = 'overheads'; f.overhead_kind = kind; marks.add('overhead_kind') }
    setParts(null)
    setForm(f)
    setSuggested(marks)
  }

  async function save() {
    if (!current?.path) return
    if (!YMD.test(form.date)) {
      updateCurrent({ error: 'Enter the slip date.' })
      return
    }
    const total = Number(form.total_incl || 0)
    const vat = form.vat === '' ? splitInclusive(total, vatRate).vat : Number(form.vat)
    if (parts) {
      const placed = round2(parts.reduce((t, x) => t + (x.amount ?? 0), 0))
      if (parts.some((x) => !(x.amount && x.amount > 0))) { updateCurrent({ error: 'Give every part an amount, or remove it.' }); return }
      if (parts.some((x) => !x.project_id && !x.overhead_kind)) { updateCurrent({ error: 'A part on no job is an overhead: choose what kind.' }); return }
      if (Math.abs(placed - total) > 0.01) { updateCurrent({ error: `The parts add up to ${formatZAR(placed)}, the slip is ${formatZAR(total)}.` }); return }
    } else {
      const problem = jobOrOverheadProblem(placeOf(form))
      if (problem) { updateCurrent({ error: problem }); return }
    }
    updateCurrent({ stage: 'saving' })
    try {
      if (parts) {
        // VAT shared by each part's share of the total; the last part takes the cents left by rounding.
        let vatLeft = round2(vat)
        for (const [i, x] of parts.entries()) {
          const amt = round2(x.amount ?? 0)
          const v = i === parts.length - 1 ? vatLeft : round2(total ? (vat * amt) / total : 0)
          vatLeft = round2(vatLeft - v)
          await expensesApi.create({
            date: form.date,
            supplier: form.supplier || null,
            description: [x.description, `part ${i + 1} of ${parts.length}`].filter(Boolean).join(' · ') || null,
            receipt_number: form.receipt_number || null,
            category: x.project_id ? x.category : 'overheads',
            overhead_kind: x.project_id ? null : x.overhead_kind ?? null,
            project_id: x.project_id,
            stage_id: x.project_id ? x.stage_id : null,
            amount_excl: round2(amt - v),
            vat: v,
            paid: form.paid,
            receipt_path: current.path,
            ai_extracted: current.extraction ?? null,
            ai_suggestion: null,
            source: 'receipt',
          })
        }
        setSavedCount((n) => n + 1)
        next()
        return
      }
      await expensesApi.create({
        date: form.date,
        supplier: form.supplier || null,
        description: form.description || null,
        receipt_number: form.receipt_number || null,
        ...expenseFieldsFor(placeOf(form)),
        amount_excl: round2(total - vat),
        vat: round2(vat),
        paid: form.paid,
        receipt_path: current.path,
        ai_extracted: current.extraction ?? null,
        ai_suggestion: null,
        source: 'receipt',
      })
      setSavedCount((n) => n + 1)
      next()
    } catch (e) {
      updateCurrent({ stage: 'review', error: e instanceof Error ? e.message : String(e) })
    }
  }

  /** Drops the head slip and deletes its upload (an upload still running is cleaned up when it lands). */
  async function discard() {
    if (!current) return
    removed.current.add(current.id)
    const path = current.path
    next()
    if (path) await supabase.storage.from(RECEIPTS_BUCKET).remove([path]).catch(() => {})
  }

  function next() {
    if (current) URL.revokeObjectURL(current.previewUrl)
    setParts(null)
    setQueue((q) => q.slice(1))
    setForm(blankForm(presetProject))
    setSuggested(new Set())
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setSuggested((s) => {
      const n = new Set(s)
      n.delete(k)
      return n
    })
  }
  const hl = (k: keyof FormState) => (suggested.has(k) ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-300/40' : '')
  const totalNum = Number(form.total_incl || 0)
  const vatNum = form.vat === '' ? splitInclusive(totalNum, vatRate).vat : Number(form.vat)

  // ---------- Pickers ----------
  const pickers = (
    <>
      <input ref={cameraRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
      <input ref={filesRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
    </>
  )

  if (!current) {
    return (
      <div>
        {pickers}
        <Link to={back} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> {back === paths.expenses() ? 'Expenses' : 'Dashboard'}</Link>
        <PageHeader title="Snap slip" subtitle="Photograph a till slip or supplier invoice. It's stored with the expense." />
        {savedCount > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={18} /> {savedCount} slip{savedCount === 1 ? '' : 's'} saved.
          </div>
        )}
        <div className="mx-auto flex max-w-md flex-col gap-3">
          <button
            onClick={() => cameraRef.current?.click()}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-brand-500 px-6 py-12 text-white shadow-lg shadow-brand-500/20 active:scale-[0.99]"
          >
            <Camera size={44} />
            <span className="text-xl font-semibold">Snap slip</span>
            <span className="text-sm opacity-80">Opens the camera on your phone</span>
          </button>
          <Button size="lg" onClick={() => filesRef.current?.click()}>
            <Images size={18} /> Choose files (several at once)
          </Button>
          <Button variant="ghost" onClick={() => navigate(back)}>Done</Button>
        </div>
      </div>
    )
  }

  const busy = current.stage === 'uploading' || current.stage === 'reading'
  const isPdf = inferFileType(current.file) === 'application/pdf'

  return (
    <div>
      {pickers}
      <PageHeader
        title="Review slip"
        subtitle={queue.length > 1 ? `${queue.length - 1} more waiting` : undefined}
        actions={<Button variant="ghost" onClick={discard}><X size={15} /> Discard</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card padded={false} className="overflow-hidden">
          <div className="flex max-h-[70dvh] min-h-64 items-center justify-center bg-slate-900">
            {isPdf ? (
              <object data={current.previewUrl} type="application/pdf" className="h-[70dvh] w-full">
                <div className="flex flex-col items-center p-8 text-slate-300"><FileText size={40} /><p className="mt-2 text-sm">{current.file.name}</p></div>
              </object>
            ) : (
              <img src={current.previewUrl} alt="Slip" className="max-h-[70dvh] w-auto object-contain" />
            )}
          </div>
        </Card>

        <Card>
          {busy ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-sm text-slate-500">
              <Loader2 className="animate-spin text-brand-500" size={28} />
              {current.stage === 'uploading' ? 'Uploading slip…' : 'Reading slip…'}
            </div>
          ) : current.stage === 'error' ? (
            <div className="py-8 text-center">
              <p className="text-sm text-red-600">{current.error}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={() => updateCurrent({ stage: 'uploading', error: undefined })}>Try again</Button>
                <Button variant="ghost" onClick={discard}>Skip</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {current.aiNote ? <p className="text-xs text-slate-500">{current.aiNote}</p> : null}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Supplier" className="col-span-2"><input className={`input ${hl('supplier')}`} value={form.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field>
                <Field label="Date"><input type="date" className="input" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
                <Field label="Slip / invoice no."><input className="input" value={form.receipt_number} onChange={(e) => set('receipt_number', e.target.value)} /></Field>
                <Field label="Total incl. VAT"><NumInput allowEmpty prefix="R" className="text-lg font-semibold" value={form.total_incl === '' ? null : Number(form.total_incl)} onValue={(n) => set('total_incl', n === null ? '' : String(n))} /></Field>
                <Field label="VAT" hint={vatRate === 0 ? 'Not registered for VAT: the full amount is the cost.' : form.vat === '' ? `Calculated at ${vatRate}%` : undefined}>
                  <NumInput allowEmpty prefix="R" value={form.vat === '' ? null : Number(form.vat)} placeholder={String(splitInclusive(totalNum, vatRate).vat)} onValue={(n) => set('vat', n === null ? '' : String(n))} />
                </Field>
                <p className="col-span-2 -mt-1 text-xs text-slate-500">Excl. VAT {formatZAR(totalNum - vatNum)}</p>
                {parts ? (
                  <SplitParts parts={parts} projects={projects ?? []} total={totalNum} setPart={setPart}
                    onAdd={() => setParts((ps) => ps && [...ps, newPart({ amount: Math.max(0, round2(totalNum - ps.reduce((t, x) => t + (x.amount ?? 0), 0))) || null })])}
                    onRemove={(key) => setParts((ps) => { const left = (ps ?? []).filter((x) => x.key !== key); return left.length < 2 ? null : left })}
                    onCancel={() => setParts(null)} />
                ) : <>
                {/* A JOB OR OVERHEADS (Remus · Handover 8): Stephan, "if it's overheads, what is the category?" */}
                <JobOrOverhead className="col-span-2" projects={projects ?? []} value={placeOf(form)} highlightKind={suggested.has('overhead_kind')}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, for: v.for, project_id: v.project_id, stage_id: v.stage_id, category: v.category, overhead_kind: v.overhead_kind }))
                    if (v.overhead_kind !== form.overhead_kind) setSuggested((sg) => { const n = new Set(sg); n.delete('overhead_kind'); return n })
                  }} />
                <Field label="Description" className="col-span-2"><input className={`input ${hl('description')}`} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
                <button type="button" data-testid="slip-split" className="col-span-2 -mt-1 inline-flex items-center gap-1.5 justify-self-start text-xs font-medium text-brand-700 hover:underline"
                  onClick={() => setParts([
                    newPart({ project_id: form.for === 'job' ? form.project_id : null, stage_id: form.for === 'job' ? form.stage_id : null, category: form.for === 'job' ? form.category : 'materials', overhead_kind: form.for === 'overheads' ? form.overhead_kind : null, description: form.description, amount: totalNum ? round2(totalNum / 2) : null }),
                    newPart({ category: form.category, amount: totalNum ? round2(totalNum - round2(totalNum / 2)) : null }),
                  ])}>
                  <Split size={13} /> Split this slip across jobs (or jobs and overheads)
                </button>
                </>}
                <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.paid} onChange={(e) => set('paid', e.target.checked)} /> Already paid</label>
              </div>
              {/* WHAT WAS ON THE SLIP, against the products book: an Avoid is said in red, and any item can be added. */}
              {current.extraction?.line_items?.length ? (
                <div className="rounded-xl border border-slate-200 p-3" data-testid="slip-items">
                  <p className="mb-1.5 text-xs font-semibold text-slate-600">On the slip</p>
                  <ul className="space-y-2">
                    {current.extraction.line_items.slice(0, 12).map((li, i) => (
                      <li key={i}>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate text-slate-800">{li.quantity && li.quantity !== 1 ? `${li.quantity} × ` : ''}{li.description}</span>
                          <span className="flex shrink-0 items-center gap-2">
                            {li.amount != null && <span className="tabular text-slate-600">{formatZAR(li.amount)}</span>}
                            <button type="button" onClick={() => setAddingProduct({ name: li.description, price: li.amount != null && li.quantity ? round2(li.amount / li.quantity) : li.amount })}
                              className="text-xs font-medium text-brand-700 hover:underline" data-testid="slip-item-add">+ Products</button>
                          </span>
                        </div>
                        <ProductAdvice className="mt-1" text={li.description} book={productBook} max={1} />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {current.error && <p className="text-sm text-red-600">{current.error}</p>}
              <div className="flex gap-2 pt-2">
                <Button variant="primary" size="lg" className="flex-1" onClick={save} loading={current.stage === 'saving'} disabled={!form.total_incl}>
                  Save expense
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
      {addingProduct && (
        <ProductForm product={null} uses={[]} projects={projects ?? []} canWrite
          categories={[...new Set((productBook ?? []).map((p) => p.category).filter((c): c is string => !!c))]}
          preset={{ name: addingProduct.name, last_price: addingProduct.price, store: form.supplier || null, project_id: form.project_id }}
          onClose={() => setAddingProduct(null)} onSaved={() => { setAddingProduct(null); reloadBook() }} />
      )}
    </div>
  )
}

/** The parts of a split slip: each a project, stage, kind and amount; what is left to place under them. */
function SplitParts({ parts, projects, total, setPart, onAdd, onRemove, onCancel }: {
  parts: Part[]
  projects: Project[]
  total: number
  setPart: (key: string, patch: Partial<Part>) => void
  onAdd: () => void
  onRemove: (key: string) => void
  onCancel: () => void
}) {
  const placed = round2(parts.reduce((t, x) => t + (x.amount ?? 0), 0))
  const left = round2(total - placed)
  return (
    <div className="col-span-2 space-y-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3" data-testid="split-parts">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Split size={14} /> Split across {parts.length} parts</span>
        <button type="button" onClick={onCancel} className="text-xs text-slate-500 hover:underline">Don't split</button>
      </div>
      {parts.map((x, i) => (
        <div key={x.key} className="rounded-lg border border-slate-200 bg-white p-2.5" data-testid="split-part">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
            <span>Part {i + 1}</span>
            <button type="button" onClick={() => onRemove(x.key)} aria-label={`Remove part ${i + 1}`} className="rounded p-0.5 hover:bg-slate-100"><X size={13} /></button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <ProjectSelect projects={projects} value={x.project_id} onChange={(v) => setPart(x.key, { project_id: v, stage_id: null })} />
              <StageSelect className="mt-1.5" projectId={x.project_id} value={x.stage_id} onChange={(v) => setPart(x.key, { stage_id: v })} />
            </div>
            <input className="input col-span-2" placeholder="What it covers, e.g. cement" value={x.description} onChange={(e) => setPart(x.key, { description: e.target.value })} />
            {x.project_id ? (
              <select className="input" value={x.category === 'overheads' ? 'materials' : x.category} onChange={(e) => setPart(x.key, { category: e.target.value as ExpenseCategory })}>
                {EXPENSE_CATEGORIES.filter((c) => c !== 'overheads').map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
              </select>
            ) : (
              // No job: an overhead, of which kind (Remus · Handover 8).
              <select className="input" aria-label="Kind of overhead" value={x.overhead_kind ?? ''} onChange={(e) => setPart(x.key, { overhead_kind: e.target.value || null })}>
                <option value="">Overheads: what kind?</option>
                {OVERHEAD_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
              </select>
            )}
            <NumInput allowEmpty prefix="R" value={x.amount} onValue={(n) => setPart(x.key, { amount: n })} />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 text-xs">
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><Plus size={13} /> Add a part</button>
        <span className={Math.abs(left) <= 0.01 ? 'text-emerald-700' : 'font-semibold text-red-700'} data-testid="split-left">
          {Math.abs(left) <= 0.01 ? 'Adds up to the slip' : left > 0 ? `${formatZAR(left)} still to place` : `${formatZAR(-left)} too much`}
        </span>
      </div>
    </div>
  )
}
