import { useEffect, useRef, useState, type ReactNode } from 'react'
import { seesMoney, useAccess } from '../../../lib/access'
import { StageSelect } from '../components/StageSelect'
import { NumInput } from '../../../components/ui/NumInput'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, FileText, Images, Loader2, Plus, RefreshCw, Sparkles, Split, X } from 'lucide-react'
import { DictateButton } from '../../../components/ui/Dictate'
import { expenses as expensesApi, extractReceipt, projects as projectsApi, uploadReceipt } from '../../../lib/api'
import { RECEIPTS_BUCKET, supabase } from '../../../lib/supabase'
import { formatZAR, labelize, round2, todayYmd } from '../../../lib/format'
import { splitInclusive } from '../../../lib/quoteMath'
import { compressImage, inferFileType } from '../../../lib/image'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, Field, PageHeader } from '../../../components/ui'
import { EXPENSE_CATEGORIES, type ExpenseCategory, type Project, type ReceiptExtraction, type ReceiptSuggestion } from '../../../types'
import { ProjectSelect } from '../components/ProjectSelect'
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
  suggestion?: ReceiptSuggestion | null
  aiNote?: string
  /** What the person told Claude about this slip (typed or dictated); sent with the read. */
  note?: string
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
}

/** One part of a split slip (Remus · Handover 6): where it goes, and how much of the slip, incl. VAT. */
interface Part {
  key: string
  project_id: string | null
  stage_id: string | null
  category: ExpenseCategory
  description: string
  amount: number | null
}
const newPart = (p: Partial<Part> = {}): Part => ({ key: crypto.randomUUID(), project_id: null, stage_id: null, category: 'materials', description: '', amount: null, ...p })

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
})

/**
 * TELL CLAUDE (Remus · Handover 6). Stephan: "build in the AI so that Claude can send it to a project. Also put
 * dictate in there so that I can dictate to Claude." Before snapping, one note for the slips about to be taken
 * ("all of these are for the Brooklyn bathroom"); on each slip, its own note and "Ask Claude again". Claude
 * follows the note for the project, the stage, the category and the description (api/receipts/extract.ts),
 * and the person still checks it before it is saved.
 *
 * Snap slip → upload to the private 'receipts' bucket → (optionally) AI reads it and suggests a
 * project and category → person reviews beside the image → save as an expense.
 * Works without AI: the form simply starts empty.
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
  /* The note for the slips about to be snapped, and the one being written on the slip in review. */
  const [batchNote, setBatchNote] = useState('')
  const batchNoteRef = useRef(batchNote)
  batchNoteRef.current = batchNote
  const [slipNote, setSlipNote] = useState('')
  /*
   * SPLIT ACROSS PROJECTS (Remus · Handover 6). Stephan: "R10,000 of cement, but R5,000 is for one project and
   * R5,000 for the other ... you should be able to split the slip. And also dictate that." Null: the slip goes to
   * one place (the form below). Parts: one expense each, all on the same slip photo, VAT shared pro rata.
   */
  const [parts, setParts] = useState<Part[] | null>(null)
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
    const note = batchNoteRef.current.trim() || undefined
    const slips = Array.from(files).map((file) => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), stage: 'uploading' as Stage, note }))
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
        const res = await extractReceipt(path, slip.note)
        if (removed.current.has(id)) return
        const isHead = queueRef.current[0]?.id === id
        if (res.configured) {
          updateSlip(id, { stage: 'review', extraction: res.extraction, suggestion: res.suggestion })
          if (isHead) { prefill(res.extraction, res.suggestion); setSlipNote(slip.note ?? '') }
        } else {
          updateSlip(id, { stage: 'review', extraction: null, suggestion: null, aiNote: res.message })
          if (isHead) {
            setForm(blankForm(presetProject))
            setSuggested(new Set())
            setSlipNote(slip.note ?? '')
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

  function prefill(x: ReceiptExtraction, s: ReceiptSuggestion | null) {
    const marks = new Set<keyof FormState>()
    const total = x.total_incl ?? (x.amount_excl !== null && x.vat !== null ? round2(x.amount_excl + x.vat) : null)
    // Not registered for VAT (rate 0): the slip's VAT is part of the cost, so none is split out.
    const vat = vatRateRef.current === 0 ? (total !== null ? 0 : null) : x.vat ?? (total !== null ? splitInclusive(total, vatRateRef.current).vat : null)
    const f = blankForm(presetProject)
    if (x.supplier) f.supplier = x.supplier
    if (x.date && YMD.test(x.date)) f.date = x.date
    if (x.slip_number) f.receipt_number = x.slip_number
    if (total !== null) f.total_incl = String(total)
    if (vat !== null) f.vat = String(vat)
    if (x.line_items?.length) f.description = x.line_items.slice(0, 4).map((l) => l.description).join(', ').slice(0, 200)
    setParts(s?.split && s.split.length >= 2
      ? s.split.map((x) => newPart({ project_id: x.project_id, stage_id: x.stage_id, category: x.category, description: x.description, amount: x.amount_incl }))
      : null)
    if (s) {
      f.category = s.category
      marks.add('category')
      if (!presetProject && s.project_id && projectsRef.current?.some((p) => p.id === s.project_id)) {
        f.project_id = s.project_id
        marks.add('project_id')
      }
      // The stage only of the project the form is on (the server checks it belongs to the suggested one).
      if (s.stage_id && f.project_id === s.project_id) {
        f.stage_id = s.stage_id
        marks.add('stage_id')
      }
      if (s.description) {
        f.description = s.description
        marks.add('description')
      }
    }
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
      if (Math.abs(placed - total) > 0.01) { updateCurrent({ error: `The parts add up to ${formatZAR(placed)}, the slip is ${formatZAR(total)}.` }); return }
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
            category: x.category,
            project_id: x.project_id,
            stage_id: x.project_id ? x.stage_id : null,
            amount_excl: round2(amt - v),
            vat: v,
            paid: form.paid,
            receipt_path: current.path,
            ai_extracted: current.extraction ?? null,
            ai_suggestion: current.suggestion ?? null,
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
        category: form.category,
        project_id: form.project_id,
        stage_id: form.project_id ? form.stage_id : null,
        amount_excl: round2(total - vat),
        vat: round2(vat),
        paid: form.paid,
        receipt_path: current.path,
        ai_extracted: current.extraction ?? null,
        ai_suggestion: current.suggestion ?? null,
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

  /** Reads the slip again with what the person has now told Claude. The figures are read afresh too. */
  function askAgain() {
    if (!current) return
    updateCurrent({ note: slipNote.trim() || undefined, stage: 'uploading', error: undefined })
  }

  function next() {
    if (current) URL.revokeObjectURL(current.previewUrl)
    setSlipNote('')
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
          <TellClaude value={batchNote} onChange={setBatchNote}
            label="Tell Claude about these slips (optional)"
            placeholder="e.g. These are for the Brooklyn bathroom, the tiling. Paid with the company card." />
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
              {current.suggestion ? (
                <div className="flex gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
                  <Sparkles size={16} className="mt-0.5 shrink-0 text-brand-600" />
                  <span>
                    <strong>Suggested:</strong> {labelize(current.suggestion.category)}
                    {current.suggestion.project_id ? ` → ${projects?.find((p) => p.id === current.suggestion!.project_id)?.name ?? 'project'}` : ' → overhead'}{' '}
                    <span className="text-xs opacity-75">({current.suggestion.confidence} confidence)</span>
                    <span className="block text-xs opacity-80">{current.suggestion.reason}</span>
                  </span>
                </div>
              ) : current.aiNote ? (
                <p className="text-xs text-slate-500">{current.aiNote}</p>
              ) : null}

              <TellClaude value={slipNote} onChange={setSlipNote} label="Tell Claude about this slip"
                placeholder="e.g. The cement is for the Smith job, the nails for Naidoo's bathroom, the tiling stage."
                action={
                  <Button size="sm" onClick={askAgain} disabled={!slipNote.trim() || slipNote.trim() === (current.note ?? '')} data-testid="slip-ask-again">
                    <RefreshCw size={13} /> Ask Claude again
                  </Button>
                } />

              <div className="grid grid-cols-2 gap-3">
                <Field label="Supplier" className="col-span-2"><input className="input" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field>
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
                <Field label="Category">
                  <select className={`input ${hl('category')}`} value={form.category} onChange={(e) => set('category', e.target.value as ExpenseCategory)}>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
                  </select>
                </Field>
                <Field label="Project">
                  <ProjectSelect projects={projects ?? []} value={form.project_id} onChange={(v) => { set('project_id', v); set('stage_id', null) }} highlight={suggested.has('project_id')} />
                  <StageSelect className="mt-2" projectId={form.project_id} value={form.stage_id} onChange={(v) => set('stage_id', v)} />
                </Field>
                <Field label="Description" className="col-span-2"><input className={`input ${hl('description')}`} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
                <button type="button" data-testid="slip-split" className="col-span-2 -mt-1 inline-flex items-center gap-1.5 justify-self-start text-xs font-medium text-brand-700 hover:underline"
                  onClick={() => setParts([
                    newPart({ project_id: form.project_id, stage_id: form.stage_id, category: form.category, description: form.description, amount: totalNum ? round2(totalNum / 2) : null }),
                    newPart({ category: form.category, amount: totalNum ? round2(totalNum - round2(totalNum / 2)) : null }),
                  ])}>
                  <Split size={13} /> Split this slip across projects
                </button>
                </>}
                <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.paid} onChange={(e) => set('paid', e.target.checked)} /> Already paid</label>
              </div>
              {current.extraction?.card_last4 && (
                <p className="text-xs text-slate-500">Paid by {current.extraction.payment_method ?? 'card'} ending {current.extraction.card_last4}</p>
              )}
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
    </div>
  )
}

/** A box to tell Claude about a slip, typed or spoken (the microphone is Remus's DictateButton). */
function TellClaude({ value, onChange, label, placeholder, action }: {
  value: string
  onChange: (v: string) => void
  label: string
  placeholder: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="tell-claude">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700"><Sparkles size={14} className="text-brand-600" /> {label}</span>
        <DictateButton size="small" value={value} onChange={onChange} />
      </div>
      <textarea className="input min-h-16 text-sm" rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {action && <div className="mt-2 flex justify-end">{action}</div>}
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
            <select className="input" value={x.category} onChange={(e) => setPart(x.key, { category: e.target.value as ExpenseCategory })}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
            </select>
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
