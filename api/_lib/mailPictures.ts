import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * THE MAIL PICTURE STORE, the server half (Raptor's S11 · Lean Mail, 24 Oct 2026).
 *
 * Stephan, of how Outlook does it: "save one image somewhere and then always go and check it and
 * take it back, like Microsoft, and then delete it after 30 days." So a picture drawn into an
 * email -- a signature logo, nearly always -- is saved ONCE, under the SHA-256 of its base64, in
 * the private `mail-pictures` bucket, and the stored markup names it `cid:remus-pic-<hash>`. The
 * Urban Haus logo on a thousand emails is one file. The Mail page reads it from the store
 * (src/lib/mailPictures.ts) and only goes to the mailbox for a picture the store does not have.
 *
 * Before this the pictures sat inside every stored email, base64: ~320 kB a message.
 *
 * NEVER FATAL: a picture that cannot be saved is fetched from the mailbox when the email is opened.
 */

export const PICTURE_BUCKET = 'mail-pictures'
/** Must match src/lib/mailPictures.ts -- the Mail page reads it. */
export const PICTURE_PREFIX = 'cid:remus-pic-'
/** Unused this many days and a picture is deleted. Stephan's number. */
export const PICTURE_EXPIRY_DAYS = 30
/** Logos are tens of kB; a bigger picture is a banner or a screenshot, read once. Bucket limit 2 MB. */
const MAX_PICTURE_BYTES = 1_000_000

export interface StoredPicture {
  hash: string
  contentType: string
  base64: string
}

/**
 * The markup with every embedded picture replaced by its fingerprint, and the pictures to save.
 *
 * No whitespace in the character class: in an unquoted `src=data:... alt=x`, letters and `=` are
 * base64 too, and a class with spaces would swallow the next attribute.
 */
export function extractPictures(html: string): { html: string; pictures: StoredPicture[] } {
  if (!html || !/data:image\//i.test(html)) return { html, pictures: [] }
  const found = new Map<string, StoredPicture>()
  const out = html.replace(/data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]*)/gi, (_m, type: string, b64: string) => {
    const hash = createHash('sha256').update(b64).digest('hex')
    if (!found.has(hash)) found.set(hash, { hash, contentType: type.toLowerCase(), base64: b64 })
    return PICTURE_PREFIX + hash
  })
  return { html: out, pictures: [...found.values()] }
}

export function picturePath(hash: string): string {
  return `${hash.slice(0, 2)}/${hash}`
}

/** Saves whichever pictures the store lacks and marks the rest used today. Returns how many were new. */
export async function savePictures(admin: SupabaseClient, pictures: StoredPicture[]): Promise<number> {
  const wanted = pictures.filter((p) => Math.floor(p.base64.length * 3 / 4) <= MAX_PICTURE_BYTES)
  if (wanted.length === 0) return 0
  const { data: have, error } = await admin.from('mail_pictures').select('hash').in('hash', wanted.map((p) => p.hash))
  if (error) {
    console.log(`[mailPictures] could not check the store: ${error.message}`)
    return 0
  }
  const held = new Set((have ?? []).map((r) => r.hash as string))
  if (held.size > 0) void admin.rpc('touch_mail_pictures', { p_hashes: [...held] })
  let saved = 0
  for (const p of wanted) {
    if (held.has(p.hash)) continue
    const bytes = Buffer.from(p.base64, 'base64')
    // Upsert: two mailboxes syncing the same logo at once is ordinary, and it is the same bytes.
    // The row only after the file, so a row never points at nothing.
    const up = await admin.storage.from(PICTURE_BUCKET).upload(picturePath(p.hash), bytes, { contentType: p.contentType, upsert: true })
    if (up.error) { console.log(`[mailPictures] ${p.hash.slice(0, 12)} not saved: ${up.error.message}`); continue }
    const { error: rowError } = await admin.from('mail_pictures')
      .upsert({ hash: p.hash, content_type: p.contentType, bytes: bytes.length }, { onConflict: 'hash', ignoreDuplicates: true })
    if (rowError) console.log(`[mailPictures] ${p.hash.slice(0, 12)} row not written: ${rowError.message}`)
    else saved += 1
  }
  return saved
}

/**
 * Deletes pictures nobody has opened for 30 days (run by the daily sync cron). An old email that
 * still points at one is not broken: the page finds it missing, fetches the email from the mailbox,
 * and it is saved again. The mailbox is the archive; the store is a cache.
 */
export async function expireMailPictures(admin: SupabaseClient): Promise<{ deleted: number } | { error: string }> {
  const cutoff = new Date(Date.now() - PICTURE_EXPIRY_DAYS * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await admin.from('mail_pictures').select('hash').lt('last_used_on', cutoff).limit(500)
  if (error) return { error: error.message }
  const hashes = (data ?? []).map((r) => r.hash as string)
  if (hashes.length === 0) return { deleted: 0 }
  // Files first: a row left behind is retried tomorrow, a file left behind is never found again.
  const gone = await admin.storage.from(PICTURE_BUCKET).remove(hashes.map(picturePath))
  if (gone.error) return { error: gone.error.message }
  const { error: rowError } = await admin.from('mail_pictures').delete().in('hash', hashes)
  if (rowError) return { error: rowError.message }
  return { deleted: hashes.length }
}
