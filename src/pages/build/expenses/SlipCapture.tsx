import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, FileText, Images, Loader2, Sparkles, X } from 'lucide-react'
import { expenses as expensesApi, extractReceipt, projects as projectsApi, uploadReceipt } from '../../../lib/api'
import { RECEIPTS_BUCKET, supabase } from '../../../lib/supabase'
import { formatZAR, labelize, round2, todayYmd } from '../../../lib/format'
import { splitInclusive } from '../../../lib/quoteMath'
import { compressImage, inferFileType } from '../../../lib/image'
import { useLoad } from '../../../hooks/useLoad'
import { Button, Card, Field, PageHeader } from '../../../components/ui'
import { EXPENSE_CATEGORIES, type ExpenseCategory, type ReceiptExtraction, type ReceiptSuggestion } from '../../../types'
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
  description: string
  paid: boolean
}

const blankForm = (projectId: string | null): FormState => ({
  supplier: '',
  date: todayYmd(),
  receipt_number: '',
  total_incl: '',
  vat: '',
  category: 'materials',
  project_id: projectId,
  description: '',
  paid: true,
})

/**
 * Snap slip → upload to the private 'receipts' bucket → (optionally) AI reads it and suggests a
 * project and category → person reviews beside the image → save as an expense.
 * Works without AI: the form simply starts empty.
 */
export function SlipCapture() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const presetProject = params.get('project')
  const vatRate = useVatRate()
  const { data: projects } = useLoad(() => projectsApi.list(), [], 'projects-list')
  const [queue, setQueue] = useState<Slip[]>([])
  const [savedCount, setSavedCount] = useState(0)
  const [form, setForm] = useState<FormState>(blankForm(presetProject))
  const [suggested, setSuggested] = useState<Set<keyof FormState>>(new Set())
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
          updateSlip(id, { stage: 'review', extraction: res.extraction, suggestion: res.suggestion })
          if (isHead) prefill(res.extraction, res.suggestion)
        } else {
          updateSlip(id, { stage: 'review', extraction: null, suggestion: null, aiNote: res.message })
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

  function prefill(x: ReceiptExtraction, s: ReceiptSuggestion | null) {
    const marks = new Set<keyof FormState>()
    const total = x.total_incl ?? (x.amount_excl !== null && x.vat !== null ? round2(x.amount_excl + x.vat) : null)
    const vat = x.vat ?? (total !== null ? splitInclusive(total, vatRateRef.current).vat : null)
    const f = blankForm(presetProject)
    if (x.supplier) f.supplier = x.supplier
    if (x.date && YMD.test(x.date)) f.date = x.date
    if (x.slip_number) f.receipt_number = x.slip_number
    if (total !== null) f.total_incl = String(total)
    if (vat !== null) f.vat = String(vat)
    if (x.line_items?.length) f.description = x.line_items.slice(0, 4).map((l) => l.description).join(', ').slice(0, 200)
    if (s) {
      f.category = s.category
      marks.add('category')
      if (!presetProject && s.project_id && projectsRef.current?.some((p) => p.id === s.project_id)) {
        f.project_id = s.project_id
        marks.add('project_id')
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
    updateCurrent({ stage: 'saving' })
    try {
      await expensesApi.create({
        date: form.date,
        supplier: form.supplier || null,
        description: form.description || null,
        receipt_number: form.receipt_number || null,
        category: form.category,
        project_id: form.project_id,
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

  function next() {
    if (current) URL.revokeObjectURL(current.previewUrl)
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
        <Link to={paths.expenses()} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> Expenses</Link>
        <PageHeader title="Snap slip" subtitle="Photograph a till slip or supplier invoice. It's stored with the expense." />
        {savedCount > 0 && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={18} /> {savedCount} slip{savedCount === 1 ? '' : 's'} saved.
          </div>
        )}
        <div className="mx-auto flex max-w-md flex-col gap-3">
          <button
            onClick={() => cameraRef.current?.click()}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-brand-500 px-6 py-12 text-slate-950 shadow-lg shadow-brand-500/20 active:scale-[0.99]"
          >
            <Camera size={44} />
            <span className="text-xl font-semibold">Snap slip</span>
            <span className="text-sm opacity-80">Opens the camera on your phone</span>
          </button>
          <Button size="lg" onClick={() => filesRef.current?.click()}>
            <Images size={18} /> Choose files (several at once)
          </Button>
          <Button variant="ghost" onClick={() => navigate(paths.expenses())}>Done</Button>
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

              <div className="grid grid-cols-2 gap-3">
                <Field label="Supplier" className="col-span-2"><input className="input" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field>
                <Field label="Date"><input type="date" className="input" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
                <Field label="Slip / invoice no."><input className="input" value={form.receipt_number} onChange={(e) => set('receipt_number', e.target.value)} /></Field>
                <Field label="Total incl. VAT"><input type="number" inputMode="decimal" step="0.01" className="input text-lg font-semibold" value={form.total_incl} onChange={(e) => set('total_incl', e.target.value)} /></Field>
                <Field label="VAT" hint={form.vat === '' ? `Calculated at ${vatRate}%` : undefined}>
                  <input type="number" inputMode="decimal" step="0.01" className="input" value={form.vat} placeholder={String(splitInclusive(totalNum, vatRate).vat)} onChange={(e) => set('vat', e.target.value)} />
                </Field>
                <p className="col-span-2 -mt-1 text-xs text-slate-500">Excl. VAT {formatZAR(totalNum - vatNum)}</p>
                <Field label="Category">
                  <select className={`input ${hl('category')}`} value={form.category} onChange={(e) => set('category', e.target.value as ExpenseCategory)}>
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
                  </select>
                </Field>
                <Field label="Project">
                  <ProjectSelect projects={projects ?? []} value={form.project_id} onChange={(v) => set('project_id', v)} highlight={suggested.has('project_id')} />
                </Field>
                <Field label="Description" className="col-span-2"><input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
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
