import { useEffect, useRef, useState } from 'react'
import { Camera, Minus, Plus, X } from 'lucide-react'
import { Button, Field, Modal } from '../../../components/ui'
import { NumInput } from '../../../components/ui/NumInput'
import { markReturned, slipReturns, uploadReceipt } from '../../../lib/api'
import { compressImage } from '../../../lib/image'
import { formatDate, formatZAR, labelize, round2, todayYmd } from '../../../lib/format'
import { refreshReturnCount } from '../../../lib/returnCount'
import { choicesFromSlip, itemsFromChoices, itemsTotal, type ReturnChoice, type ReturnItem, type SlipReturn } from '../../../lib/slipReturns'
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type Project } from '../../../types'
import { ProjectSelect } from '../components/ProjectSelect'
import { StageSelect } from '../components/StageSelect'
import { useVatRate } from '../BuildContext'

/** A line typed by hand: something not read off the slip, or a slip with no lines. */
interface Extra { key: string; description: string; quantity: number; amount: number | null }
const newExtra = (): Extra => ({ key: crypto.randomUUID(), description: '', quantity: 1, amount: null })

/**
 * LOG A RETURN (Remus · Handover 8). Starts from the slip: each line Claude read off it, with how many were bought
 * and a - / + for how many go back ("ten paint strippers ... only used 5"). What the store should give back adds up
 * by itself and can be overtyped. Lines can be typed by hand too. Nothing is credited yet: that waits for "Returned".
 */
export function ReturnFormModal({ open, slip, projects, onClose, onSaved }: {
  open: boolean
  slip: Expense | null
  projects: Project[]
  onClose: () => void
  onSaved: (r: SlipReturn) => void
}) {
  const [choices, setChoices] = useState<ReturnChoice[]>([])
  const [extras, setExtras] = useState<Extra[]>([])
  const [amount, setAmount] = useState<number | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [stageId, setStageId] = useState<string | null>(null)
  const [category, setCategory] = useState<ExpenseCategory>('materials')
  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const c = choicesFromSlip(slip?.ai_extracted?.line_items)
    setChoices(c)
    setExtras(c.length ? [] : [newExtra()])
    setAmount(null)
    setProjectId(slip?.project_id ?? null)
    setStageId(slip?.stage_id ?? null)
    setCategory(slip?.category ?? 'materials')
    setSupplier(slip?.supplier ?? '')
    setNote('')
    setError(null)
  }, [open, slip])

  const items: ReturnItem[] = [
    ...itemsFromChoices(choices),
    ...extras.filter((x) => x.description.trim() && x.quantity > 0).map((x) => ({
      description: x.description.trim(), quantity: x.quantity, unit_price: x.amount != null && x.quantity ? round2(x.amount / x.quantity) : null, amount: round2(x.amount ?? 0),
    })),
  ]
  const added = itemsTotal(items)
  const total = amount ?? added
  const setQty = (i: number, q: number) => setChoices((cs) => cs.map((c, j) => (j === i ? { ...c, qty: Math.max(0, Math.min(c.bought, q)) } : c)))
  const setExtra = (key: string, patch: Partial<Extra>) => setExtras((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  async function save() {
    if (!items.length) { setError('Choose what goes back: tap + next to an item, or type one.'); return }
    if (!(total > 0)) { setError('Say how much the store should give back.'); return }
    setSaving(true)
    setError(null)
    try {
      const saved = await slipReturns.create({
        expense_id: slip?.id ?? null,
        project_id: projectId,
        stage_id: projectId ? stageId : null,
        category,
        supplier: supplier.trim() || null,
        receipt_number: slip?.receipt_number ?? null,
        bought_on: slip?.date ?? null,
        items,
        amount_incl: round2(total),
        status: 'to_return',
        note: note.trim() || null,
      })
      void refreshReturnCount()
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Return items"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving} data-testid="return-save">Add to "To take back"</Button>
      </>}>
      <div className="space-y-3" data-testid="return-form">
        {slip && (
          <p className="text-sm text-slate-600">
            From the slip: <span className="font-medium text-slate-800">{slip.supplier || 'Slip'}</span>
            {slip.receipt_number ? ` · no. ${slip.receipt_number}` : ''} · {formatDate(slip.date)} · {formatZAR(slip.amount_excl + slip.vat)}
          </p>
        )}

        {choices.length > 0 && (
          <div className="rounded-xl border border-slate-200">
            <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">How many of each go back?</p>
            <ul className="divide-y divide-slate-100">
              {choices.map((c, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2" data-testid="return-choice">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{c.description}</p>
                    <p className="text-xs text-slate-500">Bought {c.bought}{c.unit_price != null ? ` · ${formatZAR(c.unit_price)} each` : ' · no price on the slip'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" aria-label={`One less ${c.description}`} onClick={() => setQty(i, c.qty - 1)} disabled={c.qty <= 0}
                      className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Minus size={14} /></button>
                    <span className={`w-8 text-center text-sm tabular ${c.qty ? 'font-semibold text-slate-900' : 'text-slate-400'}`} data-testid="return-qty">{c.qty}</span>
                    <button type="button" aria-label={`One more ${c.description}`} onClick={() => setQty(i, c.qty + 1)} disabled={c.qty >= c.bought}
                      className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Plus size={14} /></button>
                  </div>
                  {c.unit_price == null && c.qty > 0 && (
                    <span className="w-24 shrink-0"><NumInput allowEmpty prefix="R" value={c.unit_price} placeholder="each"
                      onValue={(n) => setChoices((cs) => cs.map((x, j) => (j === i ? { ...x, unit_price: n } : x)))} /></span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {extras.map((x) => (
          <div key={x.key} className="grid grid-cols-[1fr_4rem_7rem_auto] items-center gap-2" data-testid="return-extra">
            <input className="input" placeholder="What goes back, e.g. paint stripper 5L" value={x.description} onChange={(e) => setExtra(x.key, { description: e.target.value })} />
            <NumInput value={x.quantity} aria-label="How many" onValue={(n) => setExtra(x.key, { quantity: Math.max(0, n) })} />
            <NumInput allowEmpty prefix="R" placeholder="Amount" value={x.amount} onValue={(n) => setExtra(x.key, { amount: n })} />
            <button type="button" aria-label="Remove line" onClick={() => setExtras((xs) => xs.filter((y) => y.key !== x.key))} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={14} /></button>
          </div>
        ))}
        <button type="button" onClick={() => setExtras((xs) => [...xs, newExtra()])} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          <Plus size={13} /> {choices.length ? 'Something not on the list' : 'Add a line'}
        </button>

        <div className="grid grid-cols-2 gap-3">
          <Field label="The store should give back" hint={amount != null && Math.abs(amount - added) > 0.009 ? `The items add up to ${formatZAR(added)}.` : 'Incl. VAT. Adds up by itself; type over it if needed.'}>
            <NumInput allowEmpty prefix="R" className="font-semibold" value={round2(total)} onValue={(n) => setAmount(n)} data-testid="return-amount" />
          </Field>
          <Field label="Store">
            <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label="Job it comes off" className="col-span-2" hint={projectId ? undefined : 'None: company overheads.'}>
            <ProjectSelect projects={projects} value={projectId} onChange={(v) => { setProjectId(v); setStageId(null) }} />
            <StageSelect className="mt-2" projectId={projectId} value={stageId} onChange={setStageId} />
          </Field>
          <Field label="Kind">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
            </select>
          </Field>
          <Field label="Note">
            <input className="input" placeholder="e.g. unopened, in the bakkie" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">It goes on the "To take back" list. The job's cost only drops once you mark it returned with what the store gave back.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

/**
 * THE GOODS ARE BACK (Remus · Handover 8): when, the credit note's number, what the store actually gave back, and a
 * photo of the credit note. Saving writes the credit on the job (lib/api markReturned).
 */
export function ReturnedModal({ ret, onClose, onSaved }: { ret: SlipReturn | null; onClose: () => void; onSaved: (r: SlipReturn) => void }) {
  const vatRate = useVatRate()
  const [date, setDate] = useState(todayYmd())
  const [creditNumber, setCreditNumber] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!ret) return
    setDate(todayYmd())
    setCreditNumber('')
    setAmount(ret.amount_incl)
    setPhoto(null)
    setError(null)
  }, [ret])

  async function save() {
    if (!ret) return
    if (!(amount && amount > 0)) { setError('How much did the store give back?'); return }
    setSaving(true)
    setError(null)
    try {
      const path = photo ? await uploadReceipt(await compressImage(photo)) : null
      const saved = await markReturned(ret, { date, amount_incl: round2(amount), credit_number: creditNumber.trim() || null, credit_path: path }, vatRate)
      void refreshReturnCount()
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!ret} onClose={onClose} title="Returned to the store"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={saving} data-testid="returned-save">Save the credit</Button>
      </>}>
      {ret && (
        <div className="space-y-3" data-testid="returned-form">
          <p className="text-sm text-slate-600">{ret.supplier || 'Store'} · expected {formatZAR(ret.amount_incl)}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Returned on"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Credit note no."><input className="input" value={creditNumber} onChange={(e) => setCreditNumber(e.target.value)} /></Field>
            <Field label="The store gave back" className="col-span-2" hint={amount != null && Math.abs(amount - ret.amount_incl) > 0.009 ? `Expected ${formatZAR(ret.amount_incl)}.` : 'Incl. VAT.'}>
              <NumInput allowEmpty prefix="R" className="text-lg font-semibold" value={amount} onValue={setAmount} />
            </Field>
          </div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
            onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); e.target.value = '' }} />
          <Button onClick={() => fileRef.current?.click()}><Camera size={15} /> {photo ? `Credit note: ${photo.name}` : 'Photo of the credit note'}</Button>
          <p className="text-xs text-slate-500">Saving puts a credit of this amount on the job, so its cost drops by what came back.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
