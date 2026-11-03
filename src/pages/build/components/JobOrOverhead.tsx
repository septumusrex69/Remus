import { clsx } from 'clsx'
import { Briefcase, Building2 } from 'lucide-react'
import { Field } from '../../../components/ui'
import { labelize } from '../../../lib/format'
import { OVERHEAD_KINDS } from '../../../lib/overheads'
import { EXPENSE_CATEGORIES, type ExpenseCategory, type Project } from '../../../types'
import { ProjectSelect } from './ProjectSelect'
import { StageSelect } from './StageSelect'

export type SlipFor = 'job' | 'overheads'

export interface JobOrOverheadValue {
  for: SlipFor
  project_id: string | null
  stage_id: string | null
  category: ExpenseCategory
  overhead_kind: string | null
}

/** The fields an expense gets from the choice: an overhead has no job, the category 'overheads' and its kind. */
export function expenseFieldsFor(v: JobOrOverheadValue) {
  return v.for === 'overheads'
    ? { project_id: null, stage_id: null, category: 'overheads' as ExpenseCategory, overhead_kind: v.overhead_kind }
    : { project_id: v.project_id, stage_id: v.project_id ? v.stage_id : null, category: v.category === 'overheads' ? 'materials' as ExpenseCategory : v.category, overhead_kind: null }
}

/** What is missing before it can be saved, in words; null when it is complete. */
export function jobOrOverheadProblem(v: JobOrOverheadValue): string | null {
  if (v.for === 'job' && !v.project_id) return 'Choose the job, or tap Overheads.'
  if (v.for === 'overheads' && !v.overhead_kind) return 'Choose what kind of overhead it is (internet, fuel, car maintenance ...).'
  return null
}

/**
 * FOR A JOB OR OVERHEADS? (Remus · Handover 8). Stephan: "you should be able to choose ... this is overheads or this is
 * for a job. And if it's overheads, what is the category?" Two big buttons; a job asks which job, stage and what it
 * was; overheads ask what kind (lib/overheads.ts). Used by Snap slip and the expense form.
 */
export function JobOrOverhead({ value, onChange, projects, highlightKind, className }: {
  value: JobOrOverheadValue
  onChange: (v: JobOrOverheadValue) => void
  projects: Project[]
  /** The kind was guessed from the slip: drawn as a suggestion. */
  highlightKind?: boolean
  className?: string
}) {
  const set = (patch: Partial<JobOrOverheadValue>) => onChange({ ...value, ...patch })
  const tab = (f: SlipFor, label: string, Icon: typeof Briefcase) => (
    <button type="button" onClick={() => set({ for: f })} data-testid={`slip-for-${f}`} aria-pressed={value.for === f}
      className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium',
        value.for === f ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
      <Icon size={15} /> {label}
    </button>
  )
  return (
    <div className={clsx('space-y-2', className)} data-testid="job-or-overhead">
      <span className="label">What is it for?</span>
      <div className="flex gap-2">
        {tab('job', 'A job', Briefcase)}
        {tab('overheads', 'Overheads', Building2)}
      </div>
      {value.for === 'job' ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <ProjectSelect projects={projects} value={value.project_id} onChange={(v) => set({ project_id: v, stage_id: null })} />
            <StageSelect className="mt-2" projectId={value.project_id} value={value.stage_id} onChange={(v) => set({ stage_id: v })} />
          </div>
          <Field label="What was it" className="col-span-2">
            <select className="input" value={value.category === 'overheads' ? 'materials' : value.category} onChange={(e) => set({ category: e.target.value as ExpenseCategory })}>
              {EXPENSE_CATEGORIES.filter((c) => c !== 'overheads').map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
            </select>
          </Field>
        </div>
      ) : (
        <Field label="What kind of overhead" hint={highlightKind ? 'Guessed from the slip; change it if it is wrong.' : undefined}>
          <select className={clsx('input', highlightKind && 'border-brand-400 bg-brand-50 ring-2 ring-brand-300/40')} value={value.overhead_kind ?? ''}
            onChange={(e) => set({ overhead_kind: e.target.value || null })} data-testid="overhead-kind">
            <option value="">Choose…</option>
            {OVERHEAD_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </Field>
      )}
    </div>
  )
}
