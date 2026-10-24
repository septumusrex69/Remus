import { supabase } from './supabase'

/**
 * PICTURES INSIDE A KEPT EMAIL, the browser half (Raptor's S11 · Lean Mail, 24 Oct 2026).
 *
 * Remus keeps each email's words so the Mail page opens instantly, the way Outlook reads from its
 * own copy. The pictures -- signature logos, nearly always -- are kept apart, ONCE each, in the
 * private `mail-pictures` store (api/_lib/mailPictures.ts), and the stored markup names each by
 * fingerprint: `cid:remus-pic-<sha256>`. Stephan: "save one image somewhere and then always go and
 * check it and take it back, like Microsoft, and then delete it after 30 days."
 *
 * So opening an email: the words from the stored copy, the logos from the store (and from memory
 * after the first time in a visit), and the mailbox only for a picture the store does not have.
 */

/** Must match PICTURE_PREFIX in api/_lib/mailPictures.ts. */
export const PICTURE_PREFIX = 'cid:remus-pic-'

/** What pictures taken out on the morning of 24 Oct were replaced with, before the store existed. */
export const DROPPED_PICTURE = 'cid:remus-picture-not-kept'

/** The fingerprints a stored email draws. */
export function storedPictureHashes(html: string | null | undefined): string[] {
  if (!html) return []
  const re = /cid:remus-pic-([0-9a-f]{64})/gi
  const hashes = new Set<string>()
  for (let m = re.exec(html); m; m = re.exec(html)) hashes.add(m[1].toLowerCase())
  return [...hashes]
}

/** Does this email still have pictures only the mailbox can supply? */
export function picturesLeftOut(html: string | null | undefined): boolean {
  return !!html && (html.includes(DROPPED_PICTURE) || html.includes(PICTURE_PREFIX))
}

/** Kept for the visit: the company's own logo is on most mail, and downloads once. */
const memory = new Map<string, string>()

async function blobToDataUri(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * The markup with every stored picture drawn back in, as data: URIs, so the email asks nobody
 * outside Remus for anything. A picture the store does not have is left as its reference;
 * picturesLeftOut then says so and the page goes to the mailbox, which saves it again.
 */
export async function fillStoredPictures(html: string): Promise<string> {
  const hashes = storedPictureHashes(html)
  if (hashes.length === 0) return html
  const found: string[] = []
  await Promise.all(hashes.map(async (hash) => {
    if (!memory.has(hash)) {
      const { data, error } = await supabase.storage.from('mail-pictures').download(`${hash.slice(0, 2)}/${hash}`)
      if (error || !data || !data.type.startsWith('image/')) return
      const uri = await blobToDataUri(data).catch(() => '')
      if (!uri.startsWith('data:image/')) return
      memory.set(hash, uri)
    }
    found.push(hash)
  }))
  // Opened, so in use: the 30 days start over (once a day per picture, never awaited).
  if (found.length > 0) void supabase.rpc('touch_mail_pictures', { p_hashes: found })
  let out = html
  for (const hash of found) out = out.split(PICTURE_PREFIX + hash).join(memory.get(hash)!)
  return out
}
