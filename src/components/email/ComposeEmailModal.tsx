import { useId, useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import { sendEmail } from '../../lib/api'
import { Button, ErrorBanner, Field, Modal } from '../ui'
import type { ID } from '../../types'

/**
 * Sends through the signed-in person's own mailbox (Settings → My mailbox) and logs the message
 * on the client's email history. Ported from Raptor's ComposeEmailModal.
 */
export function ComposeEmailModal({
  open,
  title,
  to,
  cc: initialCc,
  recipients,
  initialSubject,
  initialBody,
  inReplyTo,
  companyId,
  contactId,
  onClose,
  onSent,
}: {
  open: boolean
  /** Overrides the heading ("Reply all", "Forward"). */
  title?: string
  /** Pre-filled recipient(s), comma separated. */
  to?: string
  /** Pre-filled Cc (Reply all). The field shows when there is one, or on "Add Cc". */
  cc?: string[]
  /**
   * Addresses to suggest: everyone already known on the client. The field stays typeable, since
   * the person who needs the email (an architect, a site agent) is often not in Remus yet.
   */
  recipients?: { email: string; label?: string }[]
  /** Pre-filled subject, e.g. "Re: ..." when replying. */
  initialSubject?: string
  initialBody?: string
  /** Message-ID of the email being answered, so the reply threads in the client's mail app. */
  inReplyTo?: string | null
  companyId?: ID | null
  contactId?: ID | null
  onClose: () => void
  onSent: () => void
}) {
  const listId = useId()
  const [address, setAddress] = useState(to ?? recipients?.[0]?.email ?? '')
  const [cc, setCc] = useState((initialCc ?? []).join(', '))
  const [showCc, setShowCc] = useState((initialCc ?? []).length > 0)
  const [subject, setSubject] = useState(initialSubject ?? '')
  const [body, setBody] = useState(initialBody ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!address.trim() || !subject.trim() || !body.trim()) return
    setSending(true)
    setError(null)
    try {
      const ccList = cc.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
      await sendEmail({ to: address.trim(), cc: ccList, subject: subject.trim(), body: body.trim(), companyId, contactId, inReplyTo })
      onSent()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that email.')
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? (initialSubject ? 'Reply' : 'New email')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={`${listId}-form`} loading={sending}><Send size={14} /> Send</Button>
        </>
      }
    >
      <form id={`${listId}-form`} onSubmit={submit} className="grid gap-3">
        <ErrorBanner error={error} />
        <Field label="To">
          <input
            className="input"
            type="email"
            multiple
            list={recipients && recipients.length > 0 ? listId : undefined}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="name@company.co.za"
            required
            autoFocus={!address}
          />
          {recipients && recipients.length > 0 && (
            <datalist id={listId}>
              {recipients.map((r) => <option key={r.email} value={r.email}>{r.label ?? r.email}</option>)}
            </datalist>
          )}
        </Field>
        {showCc ? (
          <Field label="Cc">
            <input className="input" type="email" multiple value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Separate addresses with commas" />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowCc(true)} className="-mt-1 justify-self-start text-xs font-medium text-brand-600 hover:underline">Add Cc</button>
        )}
        <Field label="Subject">
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} required autoFocus={!!address && !initialSubject} />
        </Field>
        <Field label="Message" hint="Your signature from Settings is added automatically.">
          <textarea className="input min-h-44" value={body} onChange={(e) => setBody(e.target.value)} required autoFocus={!!initialSubject} />
        </Field>
      </form>
    </Modal>
  )
}
