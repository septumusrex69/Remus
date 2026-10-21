import { useEffect, useState } from 'react'
import { FileText, Paperclip } from 'lucide-react'
import { sendQuote, quotes as quotesApi } from '../../../lib/api'
import { formatZAR } from '../../../lib/format'
import type { QuoteTotals } from '../../../lib/quoteMath'
import { Button, Field, Modal } from '../../../components/ui'
import type { Quote, QuoteAttachment } from '../../../types'

const splitEmails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)

/**
 * Emails the quote via api/quotes/send.ts. With a client-version PDF uploaded, that PDF is
 * attached; otherwise the uploaded documents/renders are attached and the email body carries
 * the quote summary. (Generating a PDF on the server is out of scope.)
 */
export function SendQuoteModal({
  open,
  onClose,
  quote,
  totals,
  attachments,
  defaultTo,
  companyName,
  beforeSend,
  onSent,
}: {
  open: boolean
  onClose: () => void
  quote: Quote
  totals: QuoteTotals
  attachments: QuoteAttachment[]
  defaultTo: string
  companyName: string
  beforeSend: () => Promise<boolean>
  onSent: (q: Quote) => void
}) {
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTo(defaultTo)
    setCc('')
    setSubject(`Quote ${quote.number ?? ''}: ${quote.title}`.trim())
    setMessage(`Good day,\n\nPlease find our quote for ${quote.title || 'the work discussed'} attached.\n\nKind regards,\n${companyName}`)
    setError(null)
  }, [open, defaultTo, quote.number, quote.title, companyName])

  const clientPdf = attachments.find((a) => a.kind === 'client_pdf')
  const files = clientPdf ? [clientPdf] : attachments.filter((a) => a.kind !== 'client_pdf')

  async function send() {
    const toList = splitEmails(to)
    if (toList.length === 0) return setError('Add at least one recipient.')
    setSending(true)
    setError(null)
    try {
      if (!(await beforeSend())) throw new Error('Could not save the quote before sending.')
      await sendQuote(quote.id, { to: toList, cc: splitEmails(cc), subject, message })
      const fresh = await quotesApi.get(quote.id)
      if (fresh) onSent(fresh)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send quote to client"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={send} loading={sending}>Send</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="To" hint="Separate several addresses with commas.">
          <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" />
        </Field>
        <Field label="Cc">
          <input className="input" value={cc} onChange={(e) => setCc(e.target.value)} />
        </Field>
        <Field label="Subject">
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Message">
          <textarea className="input min-h-32" value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="mb-1 font-medium text-slate-700">What the client receives</p>
          {clientPdf ? (
            <p className="flex items-center gap-1.5 text-slate-600"><FileText size={14} /> {clientPdf.file_name} (client version)</p>
          ) : (
            <>
              <p className="text-slate-600">
                A summary in the email body (total {formatZAR(totals.totalIncl)} incl. VAT){files.length ? ' plus:' : '.'}
              </p>
              {files.map((f) => (
                <p key={f.id} className="flex items-center gap-1.5 text-slate-600"><Paperclip size={13} /> {f.file_name}</p>
              ))}
              <p className="mt-1 text-xs text-slate-500">Tip: upload a polished PDF and mark it as the client version to send that instead.</p>
            </>
          )}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
