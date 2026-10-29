import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import { sendEmail } from '../../lib/api'
import { Button, ErrorBanner, Field, Modal } from '../ui'
import { draftKeyFor, dropDraft, findDraft, saveDraft, type MailDraft } from '../../lib/mailDrafts'
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
  forward,
  forwardOf,
  draftKey: draftKeyProp,
  contextNote,
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
  /**
   * THE FILES ON A MESSAGE BEING FORWARDED (Raptor H13, R-8): kept by default and removable here,
   * each with its x. The server takes them out of the mailbox when it sends.
   */
  forward?: { mailId: ID; names: string[] }
  /** The message a forward is of, so its draft is told apart from a forward of another. */
  forwardOf?: ID
  /** Which draft this box is (mailDrafts.ts). Worked out from what the box is when not given. */
  draftKey?: string
  /** A line under the heading, e.g. that this is a draft being carried on with. */
  contextNote?: string
  onClose: () => void
  /**
   * `leftOff`: forwarded files that could not go (too big, or gone from the mailbox).
   * `filedInSent`: false when the mailbox would not take a copy for Sent Items (Raptor S15).
   */
  onSent: (leftOff: string[], filedInSent: boolean) => void
}) {
  const listId = useId()
  const [address, setAddress] = useState(to ?? recipients?.[0]?.email ?? '')
  const [cc, setCc] = useState((initialCc ?? []).join(', '))
  const [showCc, setShowCc] = useState((initialCc ?? []).length > 0)
  const [subject, setSubject] = useState(initialSubject ?? '')
  const [body, setBody] = useState(initialBody ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keep, setKeep] = useState<string[]>(forward?.names ?? [])

  /*
   * THE DRAFT (Raptor S15, mailDrafts.ts): saved as it is typed, offered back when the same box opens again,
   * and removed when it is sent. Only once something has been typed -- a box opened and closed untouched
   * leaves nothing behind -- and after a pause, so a sentence is one save, not forty.
   */
  const draftKey = draftKeyProp ?? draftKeyFor({ title, to, subject: initialSubject, inReplyTo, forwardOf })
  const [waiting, setWaiting] = useState<MailDraft | null>(() => (draftKeyProp ? null : findDraft(draftKey)))
  const touched = useRef(false)
  const touch = () => { touched.current = true }
  useEffect(() => {
    if (!touched.current) return
    const t = setTimeout(() => {
      if (body.trim() === (initialBody ?? '').trim() && subject.trim() === (initialSubject ?? '').trim()) { dropDraft(draftKey); return }
      saveDraft({
        key: draftKey, title: title ?? (initialSubject ? 'Reply' : 'New email'),
        to: address, cc, subject, body, inReplyTo: inReplyTo ?? null,
        companyId: companyId ?? null, contactId: contactId ?? null,
        forward: forward ? { mailId: forward.mailId, names: keep } : null,
      })
    }, 700)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, cc, subject, body, keep])
  function restore(d: MailDraft) {
    touched.current = true
    setAddress(d.to); setCc(d.cc); if (d.cc) setShowCc(true); setSubject(d.subject); setBody(d.body)
    if (d.forward) setKeep(d.forward.names)
    setWaiting(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!address.trim() || !subject.trim() || !body.trim()) return
    setSending(true)
    setError(null)
    try {
      const ccList = cc.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
      const { leftOff, filedInSent } = await sendEmail({
        to: address.trim(), cc: ccList, subject: subject.trim(), body: body.trim(), companyId, contactId, inReplyTo,
        ...(forward && keep.length ? { forward: { mailId: forward.mailId, names: keep } } : {}),
      })
      dropDraft(draftKey)
      onSent(leftOff, filedInSent)
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
        {contextNote && <p className="-mt-1 text-xs text-slate-500">{contextNote}</p>}
        {waiting && (waiting.body.trim() || waiting.subject.trim()) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-slate-700" data-testid="draft-waiting">
            <span>You have an unsent draft of this from {new Date(waiting.savedAt).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</span>
            <span className="flex gap-3">
              <button type="button" onClick={() => restore(waiting)} className="font-semibold text-brand-700 hover:underline" data-testid="draft-restore">Carry on with it</button>
              <button type="button" onClick={() => { dropDraft(draftKey); setWaiting(null) }} className="text-slate-500 hover:underline">Discard it</button>
            </span>
          </div>
        )}
        <Field label="To">
          <input
            className="input"
            type="email"
            multiple
            list={recipients && recipients.length > 0 ? listId : undefined}
            value={address}
            onChange={(e) => { touch(); setAddress(e.target.value) }}
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
            <input className="input" type="email" multiple value={cc} onChange={(e) => { touch(); setCc(e.target.value) }} placeholder="Separate addresses with commas" />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowCc(true)} className="-mt-1 justify-self-start text-xs font-medium text-brand-600 hover:underline">Add Cc</button>
        )}
        <Field label="Subject">
          <input className="input" value={subject} onChange={(e) => { touch(); setSubject(e.target.value) }} required autoFocus={!!address && !initialSubject} />
        </Field>
        <Field label="Message" hint="Your signature from Settings is added automatically. What you type is kept as a draft in this browser until it is sent.">
          <textarea className="input min-h-44" value={body} onChange={(e) => { touch(); setBody(e.target.value) }} required autoFocus={!!initialSubject} />
        </Field>
        {keep.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="forward-attachments">
            {keep.map((name) => (
              <span key={name} className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                <Paperclip size={12} className="shrink-0 text-slate-400" />
                <span className="truncate">{name}</span>
                <button type="button" onClick={() => { touch(); setKeep((k) => k.filter((x) => x !== name)) }} aria-label={`Leave off ${name}`}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </form>
    </Modal>
  )
}
