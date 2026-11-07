import crypto from 'node:crypto'

/**
 * ONLINE SIGNING: THE RULES (Remus · Handover 8, copied from Raptor's src/lib/signingRules.ts and adapted).
 *
 * Stephan, 7 Nov: "Online signing, I'm not sure if that's necessary. But yeah, you can build it, and if other
 * people are going to use it, you can try that."
 *
 * PURE, so a test can hold every rule without a database: the token, the link, the fingerprint of the words,
 * what a signer must give, what the emails say. api/_lib/signing.ts does the reading and writing.
 *
 * RAPTOR'S REASONS, KEPT WORD FOR WORD WHERE THEY APPLY:
 *   - THE TOKEN IS THE AUTHORITY. No password, no account: holding the link IS the permission. So it has to be
 *     unguessable (32 bytes from the platform's random source, base64url) and reach exactly one row.
 *   - WHAT THEY SIGNED IS FROZEN AT SEND TIME. "We edited it afterwards" is the whole of a defence.
 *   - A SIGNATURE AND A NAME ARE BOTH REQUIRED. The drawing is the mark; the typed name is the identification.
 *     ECTA s13 wants a method that identifies the person AND indicates their approval.
 */

/** 32 bytes = 256 bits: the same order as a session token, far past anything that can be walked. */
export const TOKEN_BYTES = 32
/** How long a link stays open unless the office picks otherwise (Raptor's links may never expire; Remus's do). */
export const SIGNING_DAYS_DEFAULT = 14
export const SIGNING_DAYS_MAX = 60
/** A drawn signature as a PNG data URL: a few tens of KB; anything past this is not a signature pad's. */
export const SIGNATURE_MAX_CHARS = 400_000

/**
 * A fresh token, base64url WRITTEN OUT (Raptor): a '+' becomes a space when a link is pasted into something that
 * form-decodes it, and a trailing '=' is what a mail client cuts when it decides where the link ends.
 */
export function newSigningToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A token as newSigningToken makes them (43 characters of base64url), so junk never reaches the database. */
export function isSigningToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

/** The address to send. Absolute (it is pasted into an email); the origin of the deployment that made it. */
export function signingLink(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/sign/${token}`
}

/**
 * THE FINGERPRINT OF THE WORDS: SHA-256 of the text exactly as the signer is shown it, line endings made the
 * same first (a Windows browser and the server must not disagree about "\r\n"). Printed on the signed PDF, so
 * anybody holding the words can check them.
 */
export function documentHash(text: string): string {
  return crypto.createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('hex')
}

/** How many days a link stays open: the office's choice, within reason. */
export function signingDays(asked: unknown): number {
  const n = Math.round(Number(asked))
  if (!Number.isFinite(n) || n < 1) return SIGNING_DAYS_DEFAULT
  return Math.min(n, SIGNING_DAYS_MAX)
}

/** A name as typed: one line, trimmed, at most 120 characters. */
export function cleanSignerName(typed: unknown): string {
  return typeof typed === 'string' ? typed.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
}

/** A PNG data URL from a signature pad, or null. */
export function isSignaturePng(value: unknown): value is string {
  return typeof value === 'string' && value.length <= SIGNATURE_MAX_CHARS && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
}

export type SigningState = 'sent' | 'signed' | 'cancelled'

/** Why a link cannot be signed right now, or null when it can. The words a signer meets on the page. */
export function signingClosedReason(r: { state: string; expires_at: string }, nowMs: number): string | null {
  if (r.state === 'signed') return 'This document has already been signed. Nothing further is needed from you.'
  if (r.state === 'cancelled') return 'This request was withdrawn, so there is nothing to sign. Please contact us if you expected one.'
  if (Date.parse(r.expires_at) <= nowMs) return 'This link has expired. Please ask us to send you a new one.'
  return null
}

/** What a signer must give before the server will even look: the name, the drawing and the tick. */
export function signSubmitProblem(input: { name: unknown; signature: unknown; agreed: unknown }): string | null {
  if (!cleanSignerName(input.name) || cleanSignerName(input.name).length < 2) return 'Type your full name before signing.'
  if (!isSignaturePng(input.signature)) return 'Sign in the box before submitting.'
  if (input.agreed !== true) return 'Tick the box to confirm that you have read the document and agree to it.'
  return null
}

/** Who opened it, for the record: the first address in x-forwarded-for (Vercel puts the caller's first). */
export function callerIp(headers: Record<string, string | string[] | undefined>): string {
  const fwd = headers['x-forwarded-for']
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
  const real = headers['x-real-ip']
  return (first || (Array.isArray(real) ? real[0] : real) || '').slice(0, 64)
}

/* ------------------------------------------------------------------ the words of a quote and a variation */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function longDate(ymd: string | null | undefined): string {
  if (!ymd) return ''
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`
}

export function rand(n: number): string {
  const [int, frac] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}R ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac}`
}

/**
 * A QUOTE AS WORDS, the text that is frozen and fingerprinted when a quote goes for signing. The PDF the client
 * downloads is the quote's own PDF; these words are what the fingerprint is of, and they are re-made when it is
 * signed: if the quote's lines, totals or terms changed since the link went out, the two differ and the
 * signature is refused.
 */
export function quoteSigningText(q: {
  number: string | null; title: string; site_address: string | null; issue_date: string | null; valid_until: string | null
  scope?: string | null; terms?: string | null; client: string
  items: { section: string | null; description: string; quantity: number; unit: string; unit_price: number }[]
  totals: { totalExcl: number; vat: number; totalIncl: number; vatRate: number }
}): string {
  const lines: string[] = [
    `# Quotation ${q.number ?? ''}`.trim(),
    `**${q.title}**`,
    `Client: ${q.client || '-'}`,
    ...(q.site_address ? [`Site: ${q.site_address}`] : []),
    ...(q.issue_date ? [`Date: ${longDate(q.issue_date)}`] : []),
    ...(q.valid_until ? [`Valid until: ${longDate(q.valid_until)}`] : []),
  ]
  if (q.scope?.trim()) lines.push('', '## Scope of work', q.scope.trim())
  lines.push('', '## The work')
  let section: string | null | undefined
  for (const i of q.items) {
    if (!i.description.trim() && !Number(i.unit_price)) continue
    if ((i.section || null) !== section) {
      section = i.section || null
      if (section) lines.push(`**${section}**`)
    }
    const amount = Math.round(Number(i.quantity) * Number(i.unit_price) * 100) / 100
    lines.push(`- ${i.description.trim() || '(no description)'}: ${Number(i.quantity)} ${i.unit} at ${rand(Number(i.unit_price))} = ${rand(amount)}`)
  }
  lines.push('', '## Total')
  if (q.totals.vatRate > 0) {
    lines.push(`Total excluding VAT: ${rand(q.totals.totalExcl)}`, `VAT (${q.totals.vatRate}%): ${rand(q.totals.vat)}`)
  }
  lines.push(`**Total: ${rand(q.totals.totalIncl)}**`)
  if (q.terms?.trim()) lines.push('', '## Terms and conditions', q.terms.trim())
  lines.push('', 'By signing, you accept this quotation and its terms, and ask us to go ahead with the work.')
  return lines.join('\n')
}

/** A VARIATION AS WORDS, when one is sent for signing without a variation-order document. */
export function variationSigningText(v: {
  description: string; amount_excl: number; date: string; vatRate: number; project: string; site: string | null; client: string; company: string
}): string {
  const incl = Math.round(v.amount_excl * (1 + v.vatRate / 100) * 100) / 100
  return [
    '# Variation order',
    `**Project:** ${v.project}`,
    ...(v.site ? [`**Site:** ${v.site}`] : []),
    `**Client:** ${v.client || '-'}`,
    `**Date:** ${longDate(v.date)}`,
    '',
    '## The change',
    v.description.trim(),
    '',
    '## The cost',
    `- Amount of this variation: ${rand(v.amount_excl)} excluding VAT${v.vatRate > 0 ? ` (${rand(incl)} including VAT)` : ''}.`,
    '- This amount is added to (or, if it is a reduction, taken off) the contract sum.',
    '',
    `By signing, you agree to this change and its cost, and ask ${v.company} to carry it out.`,
  ].join('\n')
}

/* ------------------------------------------------------------------ the emails */

/*
 * THE BUTTON, NOT A BLUE LINE (Raptor: "make it nice and big, like a button that you can see"). Tables and
 * inline styles only, because that is all Outlook draws; the brand board's colours written out, as the portal's
 * emails do (an email cannot read the skins). And the address underneath in plain words, for a client whose mail
 * blocks the button.
 */
const MAIL = { ink: '#2B2F33', graphite: '#454B50', stone: '#EEEAE4', paper: '#FAF9F6', line: '#DDD8D0', muted: '#6B7075' }
const MAIL_FONT = 'Inter, Arial, Helvetica, sans-serif'
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function signingEmail(input: {
  company: string; signerName: string | null; title: string; url: string; message?: string | null; expiresAt: string; from?: string | null
}): { subject: string; html: string; text: string } {
  const who = input.signerName?.trim() ? `Dear ${input.signerName.trim()},` : 'Good day,'
  const until = longDate(input.expiresAt.slice(0, 10))
  const own = input.message?.trim()
  const lines = [
    who,
    own || `Please read and sign ${input.title} online. It takes a minute: open it, read it, type your name and sign with your finger or mouse.`,
    `The link works until ${until}.`,
  ]
  const p = (html: string) => `<p style="margin:0 0 16px;font-family:${MAIL_FONT};font-size:15px;line-height:1.55;color:${MAIL.ink}">${html}</p>`
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MAIL.paper};padding:24px 0"><tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid ${MAIL.line};border-radius:12px;overflow:hidden">
    <tr><td style="background:${MAIL.graphite};padding:22px 32px">
      <div style="font-family:${MAIL_FONT};font-size:13px;letter-spacing:4px;font-weight:bold;color:#FFFFFF">${escapeHtml(input.company.toUpperCase())}</div>
      <div style="font-family:${MAIL_FONT};font-size:11px;letter-spacing:2px;color:${MAIL.stone};margin-top:4px">DOCUMENT TO SIGN</div>
    </td></tr>
    <tr><td style="padding:30px 32px 14px">
        ${lines.map((l) => p(escapeHtml(l).replace(/\n/g, '<br>'))).join('\n        ')}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr>
          <td style="background:${MAIL.graphite};border-radius:8px">
            <a href="${escapeHtml(input.url)}" style="display:inline-block;padding:13px 26px;font-family:${MAIL_FONT};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none">Read and sign ${escapeHtml(input.title)} &rarr;</a>
          </td>
        </tr></table>
        ${p(`<span style="color:${MAIL.muted};font-size:13px">Or open this address: ${escapeHtml(input.url)}</span>`)}
        ${p(`Kind regards,<br>${escapeHtml(input.from?.trim() || input.company)}`)}
    </td></tr>
  </table>
</td></tr></table>`
  const text = `${lines.join('\n\n')}\n\nOpen the document here:\n${input.url}\n\nKind regards,\n${input.from?.trim() || input.company}`
  return { subject: `Please sign: ${input.title}`, html, text }
}

/** The signer's own copy, after they signed (Raptor's signed-copy email). */
export function signedCopyEmail(input: { company: string; signerName: string; title: string }): { subject: string; html: string; text: string } {
  const text = `Dear ${input.signerName},\n\nThank you for signing ${input.title}. Your signed copy is attached.\n\nKind regards,\n${input.company}`
  return {
    subject: `Signed: ${input.title}`,
    text,
    html: `<div style="font-family:${MAIL_FONT};font-size:15px;line-height:1.55;color:${MAIL.ink}">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`,
  }
}

/** The line in the office's bell. */
export function signedNotice(input: { name: string; title: string; client: string }): string {
  return `${input.name}${input.client ? ` (${input.client})` : ''} signed ${input.title} online.`
}

/** A file name for a PDF. */
export function pdfName(title: string, signed: boolean): string {
  const safe = title.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Document'
  return `${safe}${signed ? '-signed' : ''}.pdf`
}
