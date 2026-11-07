import { useEffect, useState } from 'react'
import { Check, Copy, MessageCircle, PenLine } from 'lucide-react'
import { Button, Field, Modal } from '../ui'
import { sendForSigning, type SigningCreated } from '../../lib/documentsApi'
import { signingWhatsAppMessage } from '../../lib/signingStatus'
import { whatsAppLink, whatsAppNumber } from '../../lib/whatsapp'
import { longDate } from '../../lib/documentTemplates'

/**
 * SEND FOR SIGNING (Remus · Handover 8; Raptor's SigningPanel "Send for signature", adapted). A Library
 * document, a quote or a variation goes to the client as a link. The link is shown here ONCE (only its
 * fingerprint is kept), to copy or to WhatsApp; emailing it sends a button from the person's own mailbox, the
 * same path as a quote. Raptor's firm: "you should email the link or you should SMS the link or somehow...
 * because now you copy the link. That's bullshit." -- so all three are here.
 */
export function SendForSigningModal({ open, onClose, source, id, title, defaultName, defaultEmail, phone, companyName, senderName, onDone }: {
  open: boolean
  onClose: () => void
  source: 'document' | 'quote' | 'variation'
  id: string
  title: string
  defaultName?: string | null
  defaultEmail?: string | null
  phone?: string | null
  companyName?: string | null
  senderName?: string | null
  onDone?: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [days, setDays] = useState(14)
  const [byEmail, setByEmail] = useState(true)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<SigningCreated | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(defaultName ?? '')
    setEmail(defaultEmail ?? '')
    setByEmail(!!defaultEmail)
    setDays(14)
    setMessage('')
    setError(null)
    setMade(null)
    setCopied(false)
  }, [open, defaultName, defaultEmail])

  async function go() {
    setError(null)
    if (byEmail && !email.trim()) return setError('Type the email address to send the link to, or untick "Email the link".')
    setBusy(true)
    try {
      const r = await sendForSigning({ source, id, signerName: name.trim(), signerEmail: email.trim(), days, email: byEmail, message: message.trim() || undefined })
      setMade(r)
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!made) return
    try {
      await navigator.clipboard.writeText(made.url)
      setCopied(true)
    } catch {
      window.prompt('Copy the link:', made.url)
    }
  }

  const wa = made ? whatsAppLink(whatsAppNumber(phone), signingWhatsAppMessage({ firstName: name.split(' ')[0], senderName, companyName, title, url: made.url })) : null

  return (
    <Modal open={open} onClose={onClose} title={made ? 'Ready to sign' : `Send for signing: ${title}`}
      footer={made
        ? <Button variant="dark" onClick={onClose}>Done</Button>
        : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={() => void go()} loading={busy}><PenLine size={14} /> Make the link</Button></>}>
      {made ? (
        <div className="space-y-3" data-testid="signing-made">
          {made.emailed
            ? <p className="flex items-center gap-1.5 text-sm text-emerald-700"><Check size={15} /> Emailed to {email}.</p>
            : made.emailError
              ? <p className="text-sm text-red-600">The link was made, but the email did not go: {made.emailError}</p>
              : null}
          <p className="text-sm text-slate-600">The link works until {longDate(made.expiresAt.slice(0, 10))}. It is shown only now: copy it or send it on WhatsApp. If it is lost, send a new one.</p>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] break-all text-slate-700" data-testid="signing-url">{made.url}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy the link'}</Button>
            {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><MessageCircle size={14} /> WhatsApp</a>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">The client opens the link without signing in, reads it, types their name and signs with a finger or the mouse. You are told in the bell when it is signed.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Who signs"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their full name" /></Field>
            <Field label="Their email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
          </div>
          <Field label="The link works for" hint="Then it expires and a new one has to be sent.">
            <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={byEmail} onChange={(e) => setByEmail(e.target.checked)} /> Email the link (from your mailbox, with your signature)
          </label>
          {byEmail && (
            <Field label="Message (optional)" hint="Left empty, the email says: please read and sign it online.">
              <textarea className="input min-h-[80px]" value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
