import { useEffect, useState } from 'react'
import { Link2, Link2Off, Pencil, Receipt, Trash2 } from 'lucide-react'
import { signedUrls } from '../../../lib/api'
import { RECEIPTS_BUCKET } from '../../../lib/supabase'
import { formatDate, formatZAR, labelize } from '../../../lib/format'
import { EmptyState } from '../../../components/ui'
import type { Expense, Project } from '../../../types'

function SlipThumb({ url, onOpen }: { url?: string; onOpen: () => void }) {
  if (!url) return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-300"><Receipt size={16} /></span>
  return (
    <button onClick={onOpen} className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-slate-100 ring-1 ring-slate-200" aria-label="View slip">
      <img src={url} alt="Slip" className="h-full w-full object-cover" />
    </button>
  )
}

/** Expense list with slip thumbnails and a bank-linked indicator. Cards on phones, rows on desktop. */
export function ExpenseTable({
  rows,
  projects,
  linked,
  onEdit,
  onDelete,
  showProject = true,
}: {
  rows: Expense[]
  projects: Project[]
  linked: Set<string>
  onEdit: (e: Expense) => void
  onDelete: (e: Expense) => void
  showProject?: boolean
}) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [preview, setPreview] = useState<string | null>(null)
  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const key = rows.map((r) => r.receipt_path ?? '').join('|')

  useEffect(() => {
    const ps = rows.map((r) => r.receipt_path).filter((p): p is string => !!p && !p.endsWith('.pdf'))
    signedUrls(RECEIPTS_BUCKET, ps).then(setUrls).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (rows.length === 0) return <EmptyState title="No expenses" icon={<Receipt size={28} />} />

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {rows.map((e) => {
          const isLinked = linked.has(e.id)
          return (
            <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
              <SlipThumb url={e.receipt_path ? urls.get(e.receipt_path) : undefined} onOpen={() => setPreview(urls.get(e.receipt_path!) ?? null)} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{e.supplier || e.description || labelize(e.category)}</p>
                <p className="truncate text-xs text-slate-500">
                  {formatDate(e.date)} · {labelize(e.category)}
                  {showProject && ` · ${e.project_id ? projectName.get(e.project_id) ?? 'Project' : 'Overhead'}`}
                  {e.description && e.supplier ? ` · ${e.description}` : ''}
                </p>
              </div>
              <span
                title={isLinked ? 'Linked to a bank transaction' : 'Not yet on a bank statement'}
                className={`hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex ${isLinked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
              >
                {isLinked ? <Link2 size={11} /> : <Link2Off size={11} />} {isLinked ? 'Linked' : 'Unlinked'}
              </span>
              <span className="tabular w-28 shrink-0 text-right text-sm">
                <span className="font-medium text-slate-900">{formatZAR(e.amount_excl + e.vat)}</span>
                <span className="block text-[11px] text-slate-500">{formatZAR(e.amount_excl)} ex</span>
              </span>
              <span className="flex shrink-0 gap-0.5">
                <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => onEdit(e)} aria-label="Edit"><Pencil size={14} /></button>
                <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => onDelete(e)} aria-label="Delete"><Trash2 size={14} /></button>
              </span>
            </li>
          )
        })}
      </ul>
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="Slip" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </>
  )
}
