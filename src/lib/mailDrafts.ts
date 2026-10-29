/**
 * UNSENT EMAIL, KEPT (Raptor S15). Stephan: "Perhaps there's also not a bad idea to add a drafts section ... if
 * you are writing an email and something happens, it's annoying." Every compose box saves what is in it as it is
 * typed, under a key for what it is (a reply to this message, a forward of that one, a new email); closing the
 * box, a page that reloads, a phone that locks -- the words are still here, offered back the next time the same
 * box opens, and listed under Drafts on the Mail page. Sending removes it.
 *
 * IN THIS BROWSER, and said so: a convenience against losing work, not a mailbox. Every read and write is
 * wrapped, because a private window or an iPad with site data blocked throws on access -- and then there is
 * simply no draft, never a broken compose box.
 */
export interface MailDraft {
  key: string
  /** What the box was, said for the Drafts list: "Forward", "Reply", "New email". */
  title: string
  to: string
  cc: string
  subject: string
  body: string
  inReplyTo: string | null
  /** The client it files on, so a draft carried on with still lands on the client's Emails card. */
  companyId: string | null
  contactId: string | null
  /** A forward's message and the files still kept on it. */
  forward: { mailId: string; names: string[] } | null
  savedAt: number
}

const STORE = 'remus.mail.drafts'
const MAX_DRAFTS = 30

function read(): MailDraft[] {
  try {
    const raw = localStorage.getItem(STORE)
    const list = raw ? JSON.parse(raw) as MailDraft[] : []
    return Array.isArray(list) ? list : []
  } catch { return [] }
}
function write(list: MailDraft[]): void {
  try { localStorage.setItem(STORE, JSON.stringify(list)) } catch { /* nowhere to keep it; nothing to break */ }
}

export function listDrafts(): MailDraft[] {
  return read().sort((a, b) => b.savedAt - a.savedAt)
}
export function findDraft(key: string): MailDraft | null {
  return read().find((d) => d.key === key) ?? null
}
export function saveDraft(d: Omit<MailDraft, 'savedAt'>, now = Date.now()): void {
  const rest = read().filter((x) => x.key !== d.key)
  write([{ ...d, savedAt: now }, ...rest].slice(0, MAX_DRAFTS))
}
export function dropDraft(key: string): void {
  write(read().filter((d) => d.key !== key))
}

/** The key for a compose box: the same box opened again finds its draft; a different one does not. */
export function draftKeyFor(input: {
  title?: string | null; to?: string | null; subject?: string | null; inReplyTo?: string | null; forwardOf?: string | null
}): string {
  return [input.forwardOf ? `fwd:${input.forwardOf}` : '', input.inReplyTo ? `re:${input.inReplyTo}` : '',
    input.title ?? '', input.to ?? '', input.subject ?? ''].join('|')
}
