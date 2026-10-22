import type { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './crypto.js'
import { EMAIL_NOTES_MAX_LENGTH, findFolder, imapClient } from './mailbox.js'

/**
 * Incoming mail, ported from Raptor's api/_lib/emailSync.ts: pulls new messages from a person's
 * Inbox and Junk folders and files the ones from known clients on that client's Emails card.
 */

export interface EmailConnectionRow {
  user_id: string
  email: string
  imap_host: string
  imap_port: number
  encrypted_password: string
  last_seen_uid: number | null
  last_seen_uid_junk: number | null
}

/** On the very first sync of a mailbox there's no watermark yet — pull only the most recent messages instead of its entire history. */
const FIRST_SYNC_MESSAGE_LIMIT = 25


/** No point recording 40 filenames on one message; nobody scans past the first few. */
const MAX_ATTACHMENT_NAMES = 10

/**
 * Real attachments only -- signature logos and tracking pixels shouldn't bury a genuine
 * attachment in image001.png noise at this mailbox's volume.
 *
 * The test is `related`: mailparser sets it for parts referenced from the HTML body by cid,
 * which is exactly what an embedded signature image is. Disposition is deliberately NOT
 * used, because Apple Mail (and others) send perfectly real attachments as 'inline' -- an
 * earlier version filtered on that and silently dropped a .docx someone had genuinely
 * attached. An unnamed image with no filename is the remaining tracking-pixel shape.
 */
function realAttachmentNames(
  attachments: { filename?: string; related?: boolean; contentDisposition?: string; contentType?: string }[] | undefined,
): string[] {
  return (attachments ?? [])
    .filter((att) => !att.related && !(!att.filename && (att.contentType ?? '').startsWith('image/')))
    .map((att, i) => att.filename || `attachment-${i + 1}`)
    .slice(0, MAX_ATTACHMENT_NAMES)
}

/**
 * The client a sender belongs to: a contact (and that contact's company) first, else a company
 * whose own email matches. Raptor also checks leads here; Remus has none.
 *
 * Escaped for ilike: an address containing _ or % would otherwise match other addresses too.
 */
async function findMatch(admin: SupabaseClient, fromAddress: string): Promise<{ contactId?: string; companyId?: string } | null> {
  const email = fromAddress.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)
  const { data: contact } = await admin.from('contacts').select('id, company_id').ilike('email', email).limit(1).maybeSingle()
  if (contact) return { contactId: contact.id as string, companyId: (contact.company_id as string | null) ?? undefined }
  const { data: company } = await admin.from('companies').select('id').ilike('email', email).limit(1).maybeSingle()
  if (company) return { companyId: company.id as string }
  return null
}

export interface FetchedAttachment {
  filename: string
  contentType: string
  content: Buffer
}

/**
 * Fetches one attachment straight out of the mailbox, on demand.
 *
 * Deliberately does NOT copy files into Storage: a busy mailbox takes hundreds of
 * attachments a week, the overwhelming majority of which nobody ever opens twice, so
 * warehousing them all would mean paying indefinitely to store read-once auto-replies for
 * the sake of the handful of files that matter. The mailbox is already the archive --
 * this just reaches into it.
 *
 * Looks in the folder the message was synced from first, and falls back to searching by
 * Message-ID, since a message genuinely does move (rescued from Spam, filed into a folder)
 * after Remus logged it. Returns null if the message or the named file is gone.
 */
export async function fetchAttachment(
  conn: { email: string; imap_host: string; imap_port: number; encrypted_password: string },
  location: { folder?: string | null; uid?: number | null; messageId?: string | null },
  filename: string,
): Promise<FetchedAttachment | null> {
  const client = imapClient(conn, decrypt(conn.encrypted_password))
  await client.connect()
  try {
    const candidateFolders = location.folder ? [location.folder] : []
    if (location.messageId) {
      // Only worth listing mailboxes if we may need to hunt for a moved message.
      const mailboxes = await client.list()
      for (const box of mailboxes) if (!candidateFolders.includes(box.path)) candidateFolders.push(box.path)
    }

    for (const folder of candidateFolders) {
      const lock = await client.getMailboxLock(folder).catch(() => null)
      if (!lock) continue
      try {
        let uid = folder === location.folder ? location.uid ?? null : null
        if (uid === null && location.messageId) {
          const found = await client.search({ header: { 'message-id': location.messageId } }, { uid: true })
          uid = found === false || found.length === 0 ? null : found[found.length - 1]
        }
        if (uid === null) continue

        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
        if (!msg || !msg.source) continue
        const parsed = await simpleParser(msg.source)
        // A message found by UID alone could be a different message entirely if the
        // original was deleted and the UID reused, so confirm identity when we can.
        if (location.messageId && parsed.messageId && parsed.messageId !== location.messageId) continue

        const match = (parsed.attachments ?? []).find((att) => (att.filename || '') === filename)
        if (!match) continue
        return { filename, contentType: match.contentType || 'application/octet-stream', content: match.content as Buffer }
      } finally {
        lock.release()
      }
    }
    return null
  } finally {
    await client.logout().catch(() => {})
  }
}

/**
 * Pulls whatever's new in one mailbox since sinceUid, and logs an Activity for
 * any message whose sender matches a known Contact or Company email —
 * unmatched mail (most of an inbox, realistically) is left alone so Remus
 * timeline stays about actual clients, not everything that ever landed
 * in someone's inbox. isJunk only changes the logged subject's wording, so a
 * message a spam filter misfiled is still visible but clearly flagged as such.
 */
async function syncMailbox(
  client: ImapFlow,
  admin: SupabaseClient,
  conn: EmailConnectionRow,
  path: string,
  sinceUid: number | null,
  isJunk: boolean,
): Promise<{ logged: number; maxUid: number }> {
  let logged = 0
  const lock = await client.getMailboxLock(path)
  try {
    let uids: number[]
    if (sinceUid) {
      const found = await client.search({ uid: `${sinceUid + 1}:*` }, { uid: true })
      uids = found === false ? [] : found
    } else {
      const found = await client.search({ all: true }, { uid: true })
      uids = (found === false ? [] : found).slice(-FIRST_SYNC_MESSAGE_LIMIT)
    }

    console.log(`[emailSync] ${path}: found ${uids.length} new UID(s) since ${sinceUid ?? '(first sync)'}`)

    let maxUid = sinceUid ?? 0
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
      if (!msg || !msg.source) {
        console.log(`[emailSync] ${path} UID ${uid}: fetchOne returned no message/source, skipped`)
        continue
      }
      maxUid = Math.max(maxUid, msg.uid)

      const parsed = await simpleParser(msg.source)
      const fromAddress = parsed.from?.value?.[0]?.address
      if (!fromAddress) {
        console.log(`[emailSync] ${path} UID ${uid}: no parseable From address, skipped`)
        continue
      }

      /*
       * Thread first, sender second.
       *
       * A reply carries In-Reply-To (and References) naming the Message-ID of the message it
       * answers, and sends from Remus record that id, so a reply from an address nobody has
       * captured yet (a colleague of the client, the client's architect) still lands on the
       * client it answers.
       *
       * References is checked as well as In-Reply-To because some clients drop the latter; it
       * is walked newest-first so a long thread resolves to its most recent turn.
       */
      const threadIds: string[] = []
      if (parsed.inReplyTo) threadIds.push(...parsed.inReplyTo.split(/\s+/).filter(Boolean))
      const refs = parsed.references
      if (refs) threadIds.push(...(Array.isArray(refs) ? refs : refs.split(/\s+/)).filter(Boolean).reverse())

      let threadMatch: { companyId?: string; contactId?: string } | null = null
      for (const rawId of threadIds) {
        const id = rawId.trim()
        if (!id) continue
        const { data: parent } = await admin
          .from('activities')
          .select('company_id, contact_id')
          .eq('email_message_id', id)
          .limit(1)
          .maybeSingle()
        if (parent) {
          threadMatch = {
            companyId: (parent.company_id as string | null) ?? undefined,
            contactId: (parent.contact_id as string | null) ?? undefined,
          }
          console.log(`[emailSync] ${path} UID ${uid}: threaded onto ${id}`)
          break
        }
      }

      const match = await findMatch(admin, fromAddress)
      if (!match && !threadMatch) {
        console.log(`[emailSync] ${path} UID ${uid}: sender ${fromAddress} matches no Contact/Company and no known thread, skipped`)
        continue
      }

      // A reply from an address nobody has captured yet — a colleague of the contact, a new
      // person on the account — still belongs on the record it is answering, so the thread
      // stands on its own where the address lookup found nothing.
      const filed = {
        contactId: match?.contactId ?? threadMatch?.contactId,
        companyId: match?.companyId ?? threadMatch?.companyId,
      }
      console.log(
        `[emailSync] ${path} UID ${uid}: filed (contact=${filed.contactId ?? '-'}, company=${filed.companyId ?? '-'}), writing activity...`,
      )
      // Logged whenever a message carries parts at all, so a "my attachment vanished" report
      // can be answered from what the mail server actually sent rather than by guessing.
      if ((parsed.attachments ?? []).length > 0) {
        const described = (parsed.attachments ?? [])
          .map((att) => `${att.filename || '(no filename)'} [${att.contentType}, disposition=${att.contentDisposition ?? '-'}, related=${att.related ?? false}]`)
          .join('; ')
        console.log(`[emailSync] ${path} UID ${uid}: parts -- ${described}`)
      }

      // upsert + ignoreDuplicates rather than insert: a UID this sync reprocesses (a
      // concurrent sync, or the watermark not having advanced yet) must never log the
      // same email twice -- the unique index on (user_id, email_message_id) is what
      // actually enforces that, this just tells Postgres to skip silently on conflict
      // instead of raising an error that would abort the rest of the sync.
      const subjectPrefix = isJunk ? 'Email received (was in Spam/Junk)' : 'Email received'
      const { data: inserted, error } = await admin
        .from('activities')
        .upsert(
          {
            type: 'Email',
            user_id: conn.user_id,
            contact_id: filed.contactId ?? null,
            company_id: filed.companyId ?? null,
            subject: `${subjectPrefix}: ${parsed.subject || '(no subject)'}`,
            notes: (parsed.text || '').slice(0, EMAIL_NOTES_MAX_LENGTH),
            activity_date: (parsed.date ?? new Date()).toISOString(),
            email_message_id: parsed.messageId ?? `${conn.user_id}:${path}:${uid}`,
            is_read: false,
            // Names only -- the files stay in the mailbox. Recording them means an email
            // carrying signed drawings or an invoice can't land in Remus looking like an
            // ordinary (or, for an attachment-only email, empty) message.
            attachment_names: realAttachmentNames(parsed.attachments),
            // Breadcrumb back to the message itself, for on-demand attachment fetching.
            email_folder: path,
            email_uid: msg.uid,
          },
          { onConflict: 'user_id,email_message_id', ignoreDuplicates: true },
        )
        .select('id')
      // A duplicate (already-logged Message-ID) is silently skipped by ignoreDuplicates
      // and comes back as an empty array, not an error -- only count it when a row was
      // actually inserted.
      if (error) {
        console.error(`[emailSync] ${path} UID ${uid}: activities upsert failed: ${error.message}`)
      } else if (inserted && inserted.length > 0) {
        console.log(`[emailSync] ${path} UID ${uid}: activity ${inserted[0].id} inserted`)
        logged += 1
      } else {
        console.log(`[emailSync] ${path} UID ${uid}: upsert reported a duplicate (already logged), skipped`)
      }
    }

    return { logged, maxUid }
  } finally {
    lock.release()
  }
}

/**
 * Syncs both INBOX and, if the mail server has one, a Junk/Spam folder --
 * a client's reply that a spam filter misfiled would otherwise never reach
 * Remus at all. IMAP UIDs are only unique within a single mailbox, so each
 * folder gets and saves its own watermark; searching the Junk folder is
 * strictly additive; a connection whose server has no such folder behaves
 * exactly as before.
 */
export async function syncConnection(admin: SupabaseClient, conn: EmailConnectionRow): Promise<{ logged: number }> {
  const client = imapClient(conn, decrypt(conn.encrypted_password))

  await client.connect()
  try {
    const inboxResult = await syncMailbox(client, admin, conn, 'INBOX', conn.last_seen_uid, false)

    const mailboxes = await client.list()
    const junkPath = findFolder(mailboxes, '\\Junk', ['junk', 'spam', 'junk email', 'bulk mail', 'inbox.junk', 'inbox.spam', 'inbox/junk', 'inbox/spam'])
    console.log(
      `[emailSync] mailboxes: ${mailboxes.map((m) => `${m.path}${m.specialUse ? ` (${m.specialUse})` : ''}`).join(', ')} -- junk folder detected as: ${junkPath ?? '(none found)'}`,
    )
    const junkResult = junkPath ? await syncMailbox(client, admin, conn, junkPath, conn.last_seen_uid_junk, true) : { logged: 0, maxUid: conn.last_seen_uid_junk ?? 0 }

    // Checked deliberately: a swallowed error here would leave a watermark stuck, so a
    // future sync silently reprocesses the same already-logged messages from scratch (only
    // caught downstream by the dedup upsert above, at the cost of a full re-fetch every time).
    const patch: Record<string, unknown> = { last_seen_uid: inboxResult.maxUid, last_synced_at: new Date().toISOString() }
    if (junkPath) patch.last_seen_uid_junk = junkResult.maxUid
    const { error: watermarkError } = await admin.from('email_connections').update(patch).eq('user_id', conn.user_id)
    if (watermarkError) throw new Error(`Failed to save sync watermark: ${watermarkError.message}`)

    return { logged: inboxResult.logged + junkResult.logged }
  } finally {
    await client.logout().catch(() => {})
  }
}
