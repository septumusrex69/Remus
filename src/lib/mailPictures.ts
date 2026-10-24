/**
 * PICTURES INSIDE A KEPT MESSAGE (Raptor's mailBodyCache, S11 "Lean Mail", 24 Oct 2026).
 *
 * Remus keeps each message's body so the Mail page opens instantly, the way Outlook reads from its
 * own copy. But the mail parser (mailparser's simpleParser) rewrites every signature logo from a
 * `cid:` reference into the picture itself, base64, inside the HTML. Kept as-is, that made each
 * stored message about 320 kB on 24 Oct: 59 messages, 19 MB. Raptor's staging database filled its
 * disk the same way (710 MB, 645 MB of it logos).
 *
 * So the pictures are taken out before a body is stored, and replaced with a reference the Mail
 * page recognises. The words still open at once from the stored copy; the page then fetches the
 * message from the mailbox for its pictures, with the text already on screen.
 *
 * Used by the sync (api/_lib/emailSync.ts) and by the Mail page, so both agree on the marker.
 */

/** What a picture that was not kept is replaced with. Never a Content-ID a sender would write. */
export const DROPPED_PICTURE = 'cid:remus-picture-not-kept'

/**
 * The markup with every embedded picture replaced by DROPPED_PICTURE.
 *
 * No whitespace in the character class: in an unquoted `src=data:... alt=x`, letters and `=` are
 * base64 too, and a class with spaces would swallow the next attribute.
 */
export function withoutEmbeddedPictures(html: string): string {
  if (!html || !/data:image\//i.test(html)) return html
  return html.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]*/gi, DROPPED_PICTURE)
}

/** Does this stored message have pictures that have to come from the mailbox? */
export function picturesLeftOut(html: string | null | undefined): boolean {
  return !!html && html.includes(DROPPED_PICTURE)
}
