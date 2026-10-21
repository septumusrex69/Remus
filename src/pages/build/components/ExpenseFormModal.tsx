import { useEffect, useRef, useState } from 'react'
import { expenses } from '../../../lib/api'
import { round2, todayYmd } from '../../../lib/format'
import { splitInclusive } from '../../../lib/quoteMath'
import { Button, Field, Modal } from '../../../components/ui'
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type Project } from '../../../types'
import { ProjectSelect } from './ProjectSelect'
import { useVatRate } from '../BuildContext'
import { labelize } from '../../../lib/format'

export type ExpenseDraft = Partial<Omit<Expense, 'id' | 'created_at'>>

/** Add/edit an expense. Amounts can be typed incl. or excl. VAT. */
export function ExpenseFormModal({
  open,
  onClose,
  onSaved,
  projects,
  initial,
  editing,
}: {
  open: boolean
  onClose: () => void
  onSaved: (e: Expense) => void
  projects: Project[]
  initial?: ExpenseDraft
  editing?: Expense | null
}) {
  const vatRate = useVatRate()
  const [form, setForm] = useState<ExpenseDraft>({})
  const [inclMode, setInclMode] = useState(true)
  const [incl, setIncl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Callers often pass `initial` inline; read it through a ref so a re-render doesn't wipe the form.
  const initialRef = useRef(initial)
  initialRef.current = initial

  useEffect(() => {
    if (!open) return
    const base: ExpenseDraft = editing ?? { date: todayYmd(), category: 'materials', amount_excl: 0, vat: 0, paid: true, source: 'manual', ...initialRef.current }
    setForm(base)
    setIncl(String(round2(Number(base.amount_excl ?? 0) + Number(base.vat ?? 0)) || ''))
    setInclMode(true)
    setError(null)
  }, [open, editing])

  const set = <K extends keyof ExpenseDraft>(k: K, v: ExpenseDraft[K]) => setForm((f) => ({ ...f, [k]: v }))

  function onIncl(v: string) {
    setIncl(v)
    const n = Number(v)
    if (Number.isFinite(n)) {
      const s = splitInclusive(n, vatRate)
      setForm((f) => ({ ...f, amount_excl: s.excl, vat: s.vat }))
    }
  }

  async function save() {
    if (!form.date) return setError('Enter the expense date.')
    setSaving(true)
    setError(null)
    try {
      const values = {
        ...form,
        supplier: form.supplier?.trim() || null,
        description: form.description?.trim() || null,
        receipt_number: form.receipt_number?.trim() || null,
        amount_excl: Number(form.amount_excl ?? 0),
        vat: Number(form.vat ?? 0),
      }
      const saved = editing ? await expenses.update(editing.id, values) : await expenses.create(values)
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit expense' : 'Add expense'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="dark" onClick={save} loading={saving}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date">
          <input type="date" className="input" value={form.date ?? ''} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Category">
          <select className="input" value={form.category ?? 'materials'} onChange={(e) => set('category', e.target.value as ExpenseCategory)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
          </select>
        </Field>
        <Field label="Project" className="sm:col-span-2">
          <ProjectSelect projects={projects} value={form.project_id ?? null} onChange={(v) => set('project_id', v)} />
        </Field>
        <Field label="Supplier">
          <input className="input" value={form.supplier ?? ''} onChange={(e) => set('supplier', e.target.value)} placeholder="e.g. Builders Warehouse" />
        </Field>
        <Field label="Slip / invoice no.">
          <input className="input" value={form.receipt_number ?? ''} onChange={(e) => set('receipt_number', e.target.value || null)} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <input className="input" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-2 inline-flex rounded-lg bg-slate-100 p-1 text-xs">
            <button className={`rounded-md px-2.5 py-1 ${inclMode ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`} onClick={() => setInclMode(true)}>Enter total incl. VAT</button>
            <button className={`rounded-md px-2.5 py-1 ${!inclMode ? 'bg-white font-medium shadow-sm' : 'text-slate-500'}`} onClick={() => setInclMode(false)}>Enter excl. + VAT</button>
          </div>
          {inclMode ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Total incl. VAT">
                <input type="number" inputMode="decimal" step="0.01" className="input" value={incl} onChange={(e) => onIncl(e.target.value)} />
              </Field>
              <Field label="Excl. VAT"><input className="input" disabled value={form.amount_excl ?? 0} /></Field>
              <Field label="VAT"><input className="input" disabled value={form.vat ?? 0} /></Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount excl. VAT">
                <input type="number" inputMode="decimal" step="0.01" className="input" value={form.amount_excl ?? 0} onChange={(e) => set('amount_excl', Number(e.target.value))} />
              </Field>
              <Field label="VAT" hint={<button className="text-amber-700 underline" onClick={() => set('vat', round2((Number(form.amount_excl ?? 0) * vatRate) / 100))}>Calculate at {vatRate}%</button>}>
                <input type="number" inputMode="decimal" step="0.01" className="input" value={form.vat ?? 0} onChange={(e) => set('vat', Number(e.target.value))} />
              </Field>
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.paid ?? true} onChange={(e) => set('paid', e.target.checked)} /> Paid
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Modal>
  )
}
