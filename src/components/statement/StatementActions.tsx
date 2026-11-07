import { useEffect, useState } from 'react'
import { Download, Eye, Mail, MessageCircle, ScrollText } from 'lucide-react'
import { Button, Field, Modal } from '../ui'
import { emailConfigured, type EmailSetup } from '../../lib/api'
import { useAuth } from '../../store/AuthContext'
import { useBuild } from '../../pages/build/BuildContext'
import { useAccess } from '../../lib/access'
import { whatsAppLink, whatsAppNumber } from '../../lib/whatsapp'
import {
  STATEMENT_PERIODS, downloadStatement, previewStatement, sendStatement, shareStatement, statementEmailMessage,
  statementRange, statementWhatsAppMessage, type StatementKind, type StatementPeriod,
} from '../../lib/statement'

/**
 * THE STATEMENT'S BUTTONS (Remus · Handover 8). Stephan, 7 Nov: "Definitely a statement of account."
 *
 * Preview, Download PDF, Email to client, WhatsApp -- the quote's four ways out, for a client's statement, with the
 * period chosen first. On the client page's Invoices tab, and from Finance's outstanding list (StatementModal).
 * Raptor puts its statement behind the account's Documents button; Remus has no documents menu, so the buttons sit
 * on the statement card itself.
 */
export interface StatementClient {
  kind: StatementKind
  id: string
  name: string
  email: string | null
  /** The person to greet ("Good day Thandi"). */
  firstName: string | null
  /** Every number that could reach them on WhatsApp, the cellphone first. */
  numbers: { label: string; value: string }[]
}

const splitEmails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)

export function StatementActions({ client, compact }: { client: StatementClient; compact?: boolean }) {
  const { currentUser } = useAuth()
  const { settings } = useBuild()
  const access = useAccess()
  const [period, setPeriod] = useState<StatementPeriod>('last_3')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [emailing, setEmailing] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const range = statementRange(period)
  const ask = { kind: client.kind, id: client.id, ...range }
  const sender = currentUser?.name?.split(' ')[0] ?? null
  const waText = statementWhatsAppMessage({ firstName: client.firstName, senderName: sender, companyName: settings?.name })
  const reachable = client.numbers
    .map((n) => ({ ...n, wa: whatsAppNumber(n.value) }))
    .filter((n): n is typeof n & { wa: string } => !!n.wa)
    .filter((n, i, all) => all.findIndex((m) => m.wa === n.wa) === i)

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what)
    setError(null)
    setNote(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(null) }
  }

  /** A phone or iPad shares the FILE (pick WhatsApp); a computer downloads it and opens WhatsApp on the client. */
  function whatsApp() {
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
    const probe = typeof File !== 'undefined' ? new File([''], 'x.pdf', { type: 'application/pdf' }) : null
    if (probe && typeof nav.share === 'function' && nav.canShare?.({ files: [probe] })) {
      void run('whatsapp', async () => {
        const r = await shareStatement(ask, waText)
        if (r === 'downloaded') setNote('This device would not share the file, so the statement is in your Downloads. Attach it in WhatsApp.')
      })
      return
    }
    if (reachable.length === 1) { onComputer(reachable[0].wa); return }
    setChoosing(true)
  }
  function onComputer(number: string | null) {
    setChoosing(false)
    const tab = window.open('', '_blank')
    void run('whatsapp', async () => {
      try {
        await downloadStatement(ask)
      } catch (e) {
        tab?.close()
        throw e
      }
      const link = whatsAppLink(number, waText)
      if (tab) tab.location.href = link
      else window.location.href = link
      setNote('The statement is in your Downloads: attach it in WhatsApp (the paperclip), then send.')
    })
  }

  return (
    <div data-testid="statement-actions">
      <div className="flex flex-wrap items-center gap-2">
        {!compact && <ScrollText size={16} className="hidden text-slate-400 sm:block" />}
        <select className="input w-auto" value={period} onChange={(e) => setPeriod(e.target.value as StatementPeriod)} aria-label="Statement period" data-testid="statement-period">
          {STATEMENT_PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <Button size="sm" onClick={() => void run('preview', () => previewStatement(ask))} loading={busy === 'preview'} data-testid="statement-preview"><Eye size={14} /> Preview</Button>
        <Button size="sm" onClick={() => void run('download', () => downloadStatement(ask))} loading={busy === 'download'} data-testid="statement-download"><Download size={14} /> Download PDF</Button>
        {access === 'admin' && <>
          <Button size="sm" onClick={() => setEmailing(true)} data-testid="statement-email"><Mail size={14} /> Email</Button>
          <Button size="sm" onClick={whatsApp} loading={busy === 'whatsapp'} data-testid="statement-whatsapp"><MessageCircle size={14} /> WhatsApp</Button>
        </>}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {note && <p className="mt-2 text-sm text-slate-600">{note}</p>}
      {emailing && <EmailStatementModal client={client} ask={ask} sender={currentUser?.name ?? null} companyName={settings?.name ?? null}
        onClose={() => setEmailing(false)} onSent={(to) => { setEmailing(false); setNote(`Statement sent to ${to}.`) }} />}
      {choosing && (
        <Modal open onClose={() => setChoosing(false)} title="WhatsApp the statement">
          <p className="mb-3 text-sm text-slate-600">The statement goes to your Downloads, and WhatsApp opens with the message typed in. Attach the PDF there (the paperclip), then send.</p>
          <div className="space-y-1.5">
            {reachable.map((n) => (
              <button key={n.wa} type="button" onClick={() => onComputer(n.wa)}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50">
                <MessageCircle size={14} className="shrink-0 text-emerald-600" />
                <span className="min-w-0"><span className="block truncate font-medium">{n.value}</span><span className="block truncate text-xs text-slate-400">{n.label}</span></span>
              </button>
            ))}
            <button type="button" onClick={() => onComputer(null)}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-200 px-3.5 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50">
              <MessageCircle size={14} className="shrink-0 text-slate-400" />
              {reachable.length ? 'Someone else (choose in WhatsApp)' : 'No cellphone on file: choose the person in WhatsApp'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function EmailStatementModal({ client, ask, sender, companyName, onClose, onSent }: {
  client: StatementClient
  ask: Parameters<typeof sendStatement>[0]
  sender: string | null
  companyName: string | null
  onClose: () => void
  onSent: (to: string) => void
}) {
  const [to, setTo] = useState(client.email ?? '')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState(`Statement of account: ${client.name}`)
  const [message, setMessage] = useState(statementEmailMessage({ firstName: client.firstName, senderName: sender, companyName }))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setup, setSetup] = useState<EmailSetup | null>(null)
  useEffect(() => {
    let live = true
    emailConfigured().then((c) => live && setSetup(c))
    return () => { live = false }
  }, [])

  async function send() {
    const toList = splitEmails(to)
    if (toList.length === 0) return setError('Add at least one recipient.')
    setSending(true)
    setError(null)
    try {
      await sendStatement(ask, { to: toList, cc: splitEmails(cc), subject, message })
      onSent(toList.join(', '))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Email the statement"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={send} loading={sending} disabled={setup?.configured === false} data-testid="statement-send">Send</Button>
      </>}>
      <div className="space-y-3">
        {setup?.configured === false && (
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
            <p className="font-medium">Email sending isn't set up yet.</p>
            <p className="mt-0.5">Connect your mailbox in Settings → My email, or download the statement and email it yourself for now.</p>
          </div>
        )}
        {setup?.configured && setup.from && (
          <p className="text-sm text-slate-600">
            Sending from <span className="font-medium text-slate-800">{setup.from}</span>
            {!setup.own && <span className="text-slate-500"> (the company address; connect your own in Settings → My email)</span>}
          </p>
        )}
        <Field label="To" hint="Separate several addresses with commas."><input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" /></Field>
        <Field label="Cc"><input className="input" value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
        <Field label="Subject"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Message"><textarea className="input min-h-32" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">The client receives the statement as a PDF, with the amount due in the email itself.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

/** Finance's outstanding list opens the same buttons in a dialog, for one client. */
export function StatementModal({ client, onClose }: { client: StatementClient; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Statement: ${client.name}`}>
      <p className="mb-3 text-sm text-slate-600">Every invoice and payment for this client over the period, with a running balance, what is overdue and how to pay.</p>
      <StatementActions client={client} compact />
    </Modal>
  )
}
