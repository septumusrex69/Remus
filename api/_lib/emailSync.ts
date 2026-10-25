import type { ImapFlow } from 'imapflow'
import { simpleParser, type AddressObject } from 'mailparser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from './crypto.js'
import { EMAIL_NOTES_MAX_LENGTH, findFolder, imapClient } from './mailbox.js'

/**
 * The mailbox sync, ported from Raptor's api/_lib/emailSync.ts. Reads a person's Inbox, Junk and
 * Sent folders into `user_emails` (their Mail page), and files a message from a known client on
 * that client's Emails card (`activities`) as well.
 */

export interface EmailConnectionRow {
  user_id: string
  email: string
  imap_host: string
  imap_port: number
  encrypted_password: string
  last_seen_uid: number | null
  last_seen_uid_junk: number | null
  last_seen_uid_sent?: number | null
}

/** On the very first sync of a mailbox there's no watermark yet — pull only the most recent messages instead of its entire history. */
const FIRST_SYNC_MESSAGE_LIMIT = 40

/** The list shows this much of a message (Raptor's SNIPPET_LENGTH). */
const SNIPPET_LENGTH = 240
/** Raptor's body cache ceilings (lib/mailBodyCache.ts): past these the body isn't kept. */
const TEXT_LIMIT = 100_000
const HTML_LIMIT = 1_000_000

type Recipient = { name: string | null; address: string }

/** Everyone in a To or Cc header, as plain {name, address} pairs. */
function recipientsOf(field: AddressObject | AddressObject[] | undefined): Recipient[] {
  const groups = Array.isArray(field) ? field : field ? [field] : []
  return groups
    .flatMap((g) => g.value)
    .filter((v) => !!v.address)
    .map((v) => ({ name: v.name || null, address: v.address!.toLowerCase() }))
}

type Blocks = { addresses: Set<string>; domains: Set<string> }

/** The senders this person has blocked, loaded once per sync (Raptor's loadBlocks). */
async function loadBlocks(admin: SupabaseClient, userId: string): Promise<Blocks> {
  const { data, error } = await admin.from('mail_blocks').select('pattern, kind').eq('user_id', userId)
  // A blocklist that couldn't be read must not stop the sync. Worst case is a week of newsletters.
  if (error) return { addresses: new Set(), domains: new Set() }
  const blocks: Blocks = { addresses: new Set(), domains: new Set() }
  for (const row of data ?? []) {
    const pattern = String(row.pattern).toLowerCase()
    if (row.kind === 'domain') blocks.domains.add(pattern)
    else blocks.addresses.add(pattern)
  }
  return blocks
}

function isBlocked(address: string, blocks: Blocks): boolean {
  const clean = address.toLowerCase()
  if (blocks.addresses.has(clean)) return true
  const at = clean.lastIndexOf('@')
  return at > -1 && blocks.domains.has(clean.slice(at + 1))
}


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
  return withParsedMessage(conn, location, (parsed) => {
    const match = (parsed.attachments ?? []).find((att) => (att.filename || '') === filename)
    if (!match) return null
    return { filename, contentType: match.contentType || 'application/octet-stream', content: match.content as Buffer }
  })
}

/**
 * A message's markup WITH its pictures, read out of the mailbox for the Mail page.
 *
 * The stored copy leaves the pictures out (see withoutEmbeddedPictures), so the page shows the
 * words at once and asks for this to fill the pictures in. Nothing is written back: writing it
 * back is exactly the storage this exists to avoid.
 */
export async function fetchMessageHtml(
  conn: { email: string; imap_host: string; imap_port: number; encrypted_password: string },
  location: { folder?: string | null; uid?: number | null; messageId?: string | null },
): Promise<string | null> {
  return withParsedMessage(conn, location, (parsed) => (typeof parsed.html === 'string' ? parsed.html : null))
}

/**
 * Finds one message in the mailbox and hands it, parsed, to `take`.
 *
 * Looks in the folder the message was synced from first, and falls back to searching by
 * Message-ID, since a message genuinely does move (rescued from Spam, filed into a folder)
 * after Remus logged it. A null from `take` means "not this one, keep looking".
 */
async function withParsedMessage<T>(
  conn: { email: string; imap_host: string; imap_port: number; encrypted_password: string },
  location: { folder?: string | null; uid?: number | null; messageId?: string | null },
  take: (parsed: Awaited<ReturnType<typeof simpleParser>>) => T | null,
): Promise<T | null> {
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

        const hit = take(parsed)
        if (hit !== null) return hit
      } finally {
        lock.release()
      }
    }
    return null
  } finally {
    await client.logout().catch(() => {})
  }
}

/** Must match DROPPED_PICTURE in src/lib/mailPictures.ts -- the Mail page looks for it. */
const DROPPED_PICTURE = 'cid:remus-picture-not-kept'

/**
 * The markup to STORE: every embedded picture replaced by a reference (copy of
 * withoutEmbeddedPictures in src/lib/mailPictures.ts, because api/ can't import from src).
 *
 * mailparser rewrites each signature logo from cid: into the picture itself, base64, inside the
 * HTML. Kept as-is that was ~320 kB a message (24 Oct: 59 messages, 19 MB); Raptor's staging
 * database filled its disk the same way. The words stay; the pictures come from the mailbox when
 * the message is opened. No whitespace in the class, or `src=data:... alt=x` loses its alt.
 */
function withoutEmbeddedPictures(html: string): string {
  if (!html || !/data:image\//i.test(html)) return html
  return html.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]*/gi, DROPPED_PICTURE)
}

type FolderKind = 'inbox' | 'junk' | 'sent'

/**
 * Pulls whatever is new in one folder since sinceUid.
 *
 * Every message becomes a row in the person's mailbox (`user_emails`), except a blocked sender's.
 * A received message from a known client (or a reply to mail sent from Remus) is also filed on
 * that client's Emails card. Sent mail is a mailbox row only: what Remus sends is already on the
 * client, and mail sent from Outlook or a phone shows under Sent without being filed twice.
 */
async function syncMailbox(
  client: ImapFlow,
  admin: SupabaseClient,
  conn: EmailConnectionRow,
  path: string,
  sinceUid: number | null,
  kind: FolderKind,
  blocks: Blocks,
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
    console.log(`[emailSync] ${path} (${kind}): ${uids.length} new UID(s) since ${sinceUid ?? '(first sync)'}`)

    let maxUid = sinceUid ?? 0
    for (const uid of uids) {
      // An IMAP server returns the highest UID for "n:*" even when nothing is newer.
      if (sinceUid && uid <= sinceUid) continue
      const msg = await client.fetchOne(String(uid), { source: true, flags: true }, { uid: true })
      if (!msg || !msg.source) continue
      maxUid = Math.max(maxUid, msg.uid)
      // Already opened in Outlook or on a phone? Then it arrives in Remus already read.
      const seen = msg.flags?.has('\\Seen') ?? false

      const parsed = await simpleParser(msg.source)
      const fromAddress = parsed.from?.value?.[0]?.address?.toLowerCase()
      if (!fromAddress) continue
      const messageId = parsed.messageId ?? `${conn.user_id}:${path}:${uid}`
      const occurredAt = (parsed.date ?? new Date()).toISOString()
      const text = parsed.text || ''
      const html = typeof parsed.html === 'string' ? parsed.html : ''
      // What is stored: the same markup without its pictures, measured AFTER they come out, so a big
      // logo no longer pushes an ordinary message out of the stored copy.
      const keptHtml = withoutEmbeddedPictures(html)
      const attachments = realAttachmentNames(parsed.attachments)
      const to = recipientsOf(parsed.to)
      const cc = recipientsOf(parsed.cc)

      // ---------- The person's mailbox ----------
      if (kind === 'sent' || !isBlocked(fromAddress, blocks)) {
        const tooBig = keptHtml.length > HTML_LIMIT
        const { error: rowError } = await admin.from('user_emails').upsert(
          {
            user_id: conn.user_id,
            folder: path,
            uid: msg.uid,
            message_id: messageId,
            from_address: fromAddress,
            from_name: parsed.from?.value?.[0]?.name || null,
            subject: parsed.subject || null,
            snippet: (text || html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH) || null,
            attachment_names: attachments,
            is_junk: kind === 'junk',
            is_sent: kind === 'sent',
            to_address: to[0]?.address ?? null,
            to_name: to[0]?.name ?? null,
            to_recipients: to,
            cc_recipients: cc,
            occurred_at: occurredAt,
            // Your own sent mail is not something to read.
            read_at: kind === 'sent' || seen ? occurredAt : null,
            body_text: !tooBig && text.length <= TEXT_LIMIT ? text || null : null,
            body_html: !tooBig ? keptHtml || null : null,
            body_cached_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,message_id', ignoreDuplicates: true },
        )
        if (rowError) console.error(`[emailSync] ${path} UID ${uid}: mailbox row failed: ${rowError.message}`)
      }
      if (kind === 'sent') continue

      /*
       * ---------- Filing on a client: thread first, sender second ----------
       *
       * A reply carries In-Reply-To (and References) naming the Message-ID of the message it
       * answers, and sends from Remus record that id, so a reply from an address nobody has
       * captured yet (a colleague of the client, the client's architect) still lands on the
       * client it answers. References is walked newest-first so a long thread resolves to its
       * most recent turn.
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
          break
        }
      }

      const match = await findMatch(admin, fromAddress)
      if (!match && !threadMatch) continue

      const filed = {
        contactId: match?.contactId ?? threadMatch?.contactId,
        companyId: match?.companyId ?? threadMatch?.companyId,
      }

      // The mailbox row says which client it is on, so the Mail page can show and open it.
      await admin
        .from('user_emails')
        .update({ linked_company_id: filed.companyId ?? null, linked_contact_id: filed.contactId ?? null, linked_at: new Date().toISOString() })
        .eq('user_id', conn.user_id)
        .eq('message_id', messageId)
        .is('linked_at', null)

      // upsert + ignoreDuplicates: a message the sync re-reads must never be logged twice (the
      // unique index on (user_id, email_message_id) enforces it; this just skips quietly).
      const subjectPrefix = kind === 'junk' ? 'Email received (was in Spam/Junk)' : 'Email received'
      const { data: inserted, error } = await admin
        .from('activities')
        .upsert(
          {
            type: 'Email',
            user_id: conn.user_id,
            contact_id: filed.contactId ?? null,
            company_id: filed.companyId ?? null,
            subject: `${subjectPrefix}: ${parsed.subject || '(no subject)'}`,
            notes: text.slice(0, EMAIL_NOTES_MAX_LENGTH),
            activity_date: occurredAt,
            email_message_id: messageId,
            is_read: seen,
            // Names only: the files stay in the mailbox and are fetched when opened.
            attachment_names: attachments,
            email_folder: path,
            email_uid: msg.uid,
          },
          { onConflict: 'user_id,email_message_id', ignoreDuplicates: true },
        )
        .select('id')
      if (error) console.error(`[emailSync] ${path} UID ${uid}: activities upsert failed: ${error.message}`)
      else if (inserted && inserted.length > 0) logged += 1
    }

    if (kind !== 'sent') await catchUpReadState(client, admin, conn.user_id, path)
    return { logged, maxUid }
  } finally {
    lock.release()
  }
}

/**
 * Mail read elsewhere is read here too.
 *
 * The messages Remus still shows as unread in this folder are asked of the mail server once per
 * sync (flags only, one request), and any it reports as Seen are marked read, on the mailbox and
 * on the client's Emails card. So reading a message in Outlook or on a phone clears it in Remus by
 * the next sync. One way only: reading in Remus does not change the mailbox.
 */
async function catchUpReadState(client: ImapFlow, admin: SupabaseClient, userId: string, path: string): Promise<void> {
  const { data: unread } = await admin
    .from('user_emails')
    .select('id, uid, message_id')
    .eq('user_id', userId)
    .eq('folder', path)
    .is('read_at', null)
    .order('occurred_at', { ascending: false })
    .limit(500)
  if (!unread?.length) return
  const byUid = new Map(unread.map((r) => [Number(r.uid), r as { id: string; uid: number; message_id: string | null }]))
  const seen: { id: string; message_id: string | null }[] = []
  try {
    for await (const m of client.fetch([...byUid.keys()].join(','), { flags: true }, { uid: true })) {
      const row = byUid.get(m.uid)
      if (row && m.flags?.has('\\Seen')) seen.push(row)
    }
  } catch (err) {
    // A read state we could not check is not worth failing the sync over.
    console.error(`[emailSync] ${path}: read-state check failed: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  if (!seen.length) return
  const now = new Date().toISOString()
  await admin.from('user_emails').update({ read_at: now }).in('id', seen.map((r) => r.id))
  const messageIds = seen.map((r) => r.message_id).filter((x): x is string => !!x)
  if (messageIds.length) await admin.from('activities').update({ is_read: true }).eq('user_id', userId).in('email_message_id', messageIds)
  console.log(`[emailSync] ${path}: ${seen.length} message(s) already read in the mailbox, marked read`)
}

/**
 * Syncs the Inbox, the Junk folder (a client's reply a spam filter misfiled is still a reply) and
 * the Sent folder (mail sent from Outlook or a phone too). IMAP UIDs are only unique within one
 * folder, so each keeps its own watermark, saved in one update.
 */
export async function syncConnection(admin: SupabaseClient, conn: EmailConnectionRow): Promise<{ logged: number }> {
  const client = imapClient(conn, decrypt(conn.encrypted_password))
  const blocks = await loadBlocks(admin, conn.user_id)

  await client.connect()
  try {
    const inbox = await syncMailbox(client, admin, conn, 'INBOX', conn.last_seen_uid, 'inbox', blocks)

    const mailboxes = await client.list()
    const junkPath = findFolder(mailboxes, '\\Junk', ['junk', 'spam', 'junk email', 'bulk mail', 'inbox.junk', 'inbox.spam', 'inbox/junk', 'inbox/spam'])
    const sentPath = findFolder(mailboxes, '\\Sent', ['sent', 'sent items', 'sent messages', 'inbox.sent', 'inbox/sent'])
    const junk = junkPath
      ? await syncMailbox(client, admin, conn, junkPath, conn.last_seen_uid_junk, 'junk', blocks)
      : { logged: 0, maxUid: conn.last_seen_uid_junk ?? 0 }
    const sent = sentPath
      ? await syncMailbox(client, admin, conn, sentPath, conn.last_seen_uid_sent ?? null, 'sent', blocks)
      : { logged: 0, maxUid: conn.last_seen_uid_sent ?? 0 }

    // Checked deliberately: a swallowed error would leave a watermark stuck and every later sync
    // would re-read the same messages (the dedup above catches it, at the cost of a full re-fetch).
    const patch: Record<string, unknown> = { last_seen_uid: inbox.maxUid, last_synced_at: new Date().toISOString() }
    if (junkPath) patch.last_seen_uid_junk = junk.maxUid
    if (sentPath) patch.last_seen_uid_sent = sent.maxUid
    const { error: watermarkError } = await admin.from('email_connections').update(patch).eq('user_id', conn.user_id)
    if (watermarkError) throw new Error(`Failed to save sync watermark: ${watermarkError.message}`)

    /*
     * Everything with a client goes on that client: mail sent to them from Outlook or a phone,
     * and mail that arrived before they were captured (migration 0010). Not fatal: the mailbox
     * is synced either way, and the next sync files whatever this one missed.
     */
    const { data: filedLater, error: fileError } = await admin.rpc('file_mail_on_clients', { p_user: conn.user_id })
    if (fileError) console.error(`[emailSync] filing on clients failed: ${fileError.message}`)

    return { logged: inbox.logged + junk.logged + (Number(filedLater) || 0) }
  } finally {
    await client.logout().catch(() => {})
  }
}
