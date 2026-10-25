import type { SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'

/**
 * Quote uploads as they go out: in the PDF's Visuals and as email attachments.
 *
 * Why this exists (25 Oct 2026, "sending a quote takes super long"): photos straight off an
 * iPhone are 1.5–3 MB each. A quote with three of them was downloaded twice (once for the PDF,
 * once to attach), went out twice in the same email (inside the PDF and beside it), and the email
 * was then uploaded twice more (sent, then filed in the Sent folder): about 40 MB per send.
 *
 * Now each file is downloaded once per request, all at the same time, and photos are shrunk to a
 * size that still looks sharp on a screen or printed A4 (and turned the right way up: iPhones
 * store the rotation separately, which the PDF otherwise ignores). The originals in Storage are
 * untouched.
 */

/** Longest side, in pixels, of a photo that goes out. Plenty for a full A4 page. */
const MAX_SIDE = 1800

export type QuoteFileLoader = (path: string) => Promise<Buffer | null>

/** Downloads each Storage path once, however many times it is asked for. */
export function quoteFileLoader(db: SupabaseClient): QuoteFileLoader {
  const cache = new Map<string, Promise<Buffer | null>>()
  return (path) => {
    let hit = cache.get(path)
    if (!hit) {
      hit = db.storage
        .from('quote-files')
        .download(path)
        .then(async ({ data, error }) => (error || !data ? null : Buffer.from(await data.arrayBuffer())))
      cache.set(path, hit)
    }
    return hit
  }
}

const shrunk = new WeakMap<Buffer, Promise<Buffer>>()

/**
 * A JPEG or PNG made small enough to send, in the same format (so its file name stays right).
 * Anything else, or a photo that is already small, comes back as it was; so does one the image
 * library can't read, because sending the original beats not sending.
 */
export function shrinkPhoto(buf: Buffer, mime: string | null): Promise<Buffer> {
  const type = (mime ?? '').toLowerCase()
  const isJpeg = type === 'image/jpeg' || type === 'image/jpg'
  if (!isJpeg && type !== 'image/png') return Promise.resolve(buf)
  let job = shrunk.get(buf)
  if (!job) {
    job = (async () => {
      try {
        const img = sharp(buf, { failOn: 'none' }).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        const out = isJpeg ? await img.jpeg({ quality: 80, mozjpeg: true }).toBuffer() : await img.png({ compressionLevel: 9 }).toBuffer()
        return out.length < buf.length ? out : buf
      } catch (e) {
        console.error('[quoteFiles] could not shrink a photo; sending the original', e)
        return buf
      }
    })()
    shrunk.set(buf, job)
  }
  return job
}
