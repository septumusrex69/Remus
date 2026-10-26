import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button, Modal } from '../../../components/ui'
import { formatZAR, round2, todayYmd } from '../../../lib/format'
import { nextWorkingDay } from '../../../lib/workdays'
import type { QuoteTotals } from '../../../lib/quoteMath'
import type { Quote } from '../../../types'

/**
 * What happens when a quote is accepted (Stephan, 26 Oct 2026). Marking it accepted used to change
 * the label and nothing else, while the terms say "50% deposit on acceptance". So it offers the
 * next two steps, both ticked: the project, and a DRAFT invoice for the quote's deposit %. A draft
 * is never sent by itself; it waits on the project's Invoices tab to be checked and sent.
 */
export function AcceptQuoteModal({
  open,
  onClose,
  quote,
  totals,
  hasProject,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  quote: Quote
  totals: QuoteTotals
  hasProject: boolean
  /** start: the project's first day, to put the quote's stages on the calendar (null = no plan yet). */
  onConfirm: (choice: { project: boolean; deposit: boolean; start: string | null }) => void
}) {
  const pct = Number(quote.deposit_pct || 0)
  const [project, setProject] = useState(true)
  const [deposit, setDeposit] = useState(pct > 0)
  const [planIt, setPlanIt] = useState(true)
  const [start, setStart] = useState(() => nextWorkingDay(todayYmd()))
  useEffect(() => {
    if (open) {
      setProject(true)
      setDeposit(pct > 0)
      setPlanIt(true)
    }
  }, [open, pct])
  const making = hasProject || project
  const depositIncl = round2((totals.totalIncl * pct) / 100)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Accept ${quote.number ?? 'this quote'}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onConfirm({ project: making, deposit, start: making && planIt && !hasProject ? start : null })}>
            <Check size={15} /> Accept
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">The client accepted {formatZAR(totals.totalIncl)}. What should happen next?</p>
      <div className="space-y-3">
        {hasProject ? (
          <p className="text-sm text-slate-500">This quote already has a project.</p>
        ) : (
          <label className="flex items-start gap-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={project} onChange={(e) => setProject(e.target.checked)} />
            <span>
              <span className="block text-sm font-medium text-slate-700">Create the project</span>
              <span className="block text-xs text-slate-500">Contract value {formatZAR(totals.totalExcl)}, budget {formatZAR(totals.estimatedCost)}.</span>
            </span>
          </label>
        )}
        {!hasProject && project && (
          <div className="ml-6 rounded-lg bg-slate-50 p-3">
            <label className="flex items-start gap-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={planIt} onChange={(e) => setPlanIt(e.target.checked)} />
              <span className="text-sm font-medium text-slate-700">Put the stages on the calendar, starting</span>
            </label>
            {planIt && (
              <div className="mt-2 ml-6">
                <input type="date" className="input w-auto" value={start} onChange={(e) => setStart(e.target.value || todayYmd())} aria-label="Start date" />
                <p className="mt-1 text-xs text-slate-500">Weekends and public holidays are skipped. Change it later on the project's Plan & crew tab.</p>
              </div>
            )}
          </div>
        )}
        {pct > 0 ? (
          <label className="flex items-start gap-2.5">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} />
            <span>
              <span className="block text-sm font-medium text-slate-700">Make a draft deposit invoice: {formatZAR(depositIncl)} ({pct}%)</span>
              <span className="block text-xs text-slate-500">
                Not sent: it waits on the project's Invoices tab for you to check and send.
                {!hasProject && !project ? ' Without a project it is filed on the client only.' : ''}
              </span>
            </span>
          </label>
        ) : (
          <p className="text-sm text-slate-500">No deposit on this quote (0%). Change it in Totals if you need one.</p>
        )}
      </div>
    </Modal>
  )
}
