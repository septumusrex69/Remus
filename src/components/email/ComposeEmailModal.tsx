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
  to,
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
  /** Pre-filled recipient. */
  to?: string
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
      await sendEmail({ to: address.trim(), subject: subject.trim(), body: body.trim(), companyId, contactId, inReplyTo })
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
      title={initialSubject ? 'Reply' : 'New email'}
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
