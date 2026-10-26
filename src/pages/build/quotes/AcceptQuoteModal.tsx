import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button, Modal } from '../../../components/ui'
import { formatZAR, round2 } from '../../../lib/format'
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
  onConfirm: (choice: { project: boolean; deposit: boolean }) => void
}) {
  const pct = Number(quote.deposit_pct || 0)
  const [project, setProject] = useState(true)
  const [deposit, setDeposit] = useState(pct > 0)
  useEffect(() => {
    if (open) {
      setProject(true)
      setDeposit(pct > 0)
    }
  }, [open, pct])
  const depositIncl = round2((totals.totalIncl * pct) / 100)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Accept ${quote.number ?? 'this quote'}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onConfirm({ project: hasProject || project, deposit })}>
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
