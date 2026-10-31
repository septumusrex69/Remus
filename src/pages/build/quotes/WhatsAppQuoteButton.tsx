import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Button, Modal } from '../../../components/ui'
import { canShareFiles, downloadQuotePdf, shareQuotePdf } from '../../../lib/api'
import { whatsAppLink, whatsAppNumber } from '../../../lib/whatsapp'

/**
 * WHATSAPP THE QUOTE (Remus · Handover 6). Stephan, 27 Oct: option 3, "send the PDF file itself ... like
 * share it". Raptor's WhatsAppButton (lib/whatsapp.ts) is the model; the difference is the file.
 *
 * - A phone or iPad shares the PDF FILE through the share sheet, the message with it; pick WhatsApp there.
 * - A computer cannot share a file, so the PDF goes to Downloads and WhatsApp opens on the client's
 *   cellphone (Web or Desktop) with the message typed in, to attach it. The WhatsApp tab is opened by the
 *   press itself, before the PDF is built, so no browser calls it a pop-up.
 *
 * Afterwards it asks whether to mark the quote sent (Remus cannot see WhatsApp, so the person says).
 */
export function WhatsAppQuoteButton({ quoteId, numbers, message, beforeBuild, blocked, onSent, onError }: {
  quoteId: string
  /** Every number that could reach the client, the contact's cellphone first. */
  numbers: { label: string; value: string }[]
  /** The words that go with the PDF; edited in WhatsApp before sending. */
  message: string
  /** Saves the quote first, so the PDF shows what is on the screen. */
  beforeBuild: () => Promise<boolean>
  /** True when the quote may not go out yet (needs approval); the caller says why. */
  blocked: () => boolean
  /** Mark it sent, saying how. */
  onSent: (sentTo: string) => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [asking, setAsking] = useState<string | null>(null)
  const share = canShareFiles()
  const reachable = numbers
    .map((n) => ({ ...n, wa: whatsAppNumber(n.value) }))
    .filter((n): n is typeof n & { wa: string } => !!n.wa)
    .filter((n, i, all) => all.findIndex((m) => m.wa === n.wa) === i)

  async function onPhone() {
    setBusy(true)
    try {
      const r = await shareQuotePdf(quoteId, beforeBuild, message)
      if (r === 'shared') setAsking('WhatsApp')
      if (r === 'downloaded') onError('This device would not share the file, so the PDF is in your Downloads. Attach it in WhatsApp.')
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** On a computer: the tab opens on the press, then the PDF downloads, then the tab goes to WhatsApp. */
  async function onComputer(number: string | null, label: string) {
    setChoosing(false)
    const tab = window.open('', '_blank')
    setBusy(true)
    try {
      await downloadQuotePdf(quoteId, beforeBuild)
      const link = whatsAppLink(number, message)
      if (tab) tab.location.href = link
      else window.location.href = link
      setAsking(label)
    } catch (e) {
      tab?.close()
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function press() {
    if (blocked()) return
    if (share) { void onPhone(); return }
    if (reachable.length === 1) { void onComputer(reachable[0].wa, reachable[0].value); return }
    setChoosing(true)
  }

  return (
    <>
      <Button onClick={press} loading={busy} data-testid="whatsapp-quote"
        title={share ? 'Share the PDF: pick WhatsApp' : 'Download the PDF and open WhatsApp on the client'}>
        <MessageCircle size={15} /> WhatsApp
      </Button>
      {choosing && (
        <Modal open onClose={() => setChoosing(false)} title="WhatsApp the quote">
          <p className="mb-3 text-sm text-slate-600">
            The PDF goes to your Downloads, and WhatsApp opens with the message typed in. Attach the PDF there (the paperclip), then send.
          </p>
          <div className="space-y-1.5">
            {reachable.map((n) => (
              <button key={n.wa} type="button" onClick={() => void onComputer(n.wa, n.value)} data-testid="whatsapp-number"
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
                <MessageCircle size={14} className="shrink-0 text-emerald-600" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{n.value}</span>
                  <span className="block truncate text-xs text-slate-400">{n.label}</span>
                </span>
              </button>
            ))}
            <button type="button" onClick={() => void onComputer(null, 'WhatsApp')}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-200 px-3.5 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50">
              <MessageCircle size={14} className="shrink-0 text-slate-400" />
              {reachable.length ? 'Someone else (choose in WhatsApp)' : 'No cellphone on file: choose the person in WhatsApp'}
            </button>
          </div>
        </Modal>
      )}
      {asking && (
        <Modal open onClose={() => setAsking(null)} title="Did the quote go?"
          footer={<>
            <Button variant="ghost" onClick={() => setAsking(null)}>Not yet</Button>
            <Button variant="primary" onClick={() => { onSent(`WhatsApp ${asking === 'WhatsApp' ? '' : asking}`.trim()); setAsking(null) }} data-testid="whatsapp-mark-sent">
              Yes, mark it sent
            </Button>
          </>}>
          <p className="text-sm text-slate-600">Remus cannot see WhatsApp. If you sent the quote, mark it sent so it shows as waiting for the client.</p>
        </Modal>
      )}
    </>
  )
}
