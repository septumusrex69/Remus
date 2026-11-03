import crypto from 'node:crypto'

/**
 * AES-256-GCM at-rest encryption for mailbox passwords (copied from Raptor's api/_lib/crypto.ts).
 * Defense in depth on top of RLS (email_connections has no policies for authenticated/anon), so a
 * raw DB dump or a misconfigured policy still wouldn't expose a usable password.
 * EMAIL_CREDENTIALS_KEY must be a 32-byte key, base64-encoded.
 */
/**
 * Why the key cannot be used, or null when it can.
 *
 * getKey throws, which is right at the point of use and wrong at the edge of a request: an
 * uncaught throw inside a handler returns a 500 with no body, and the screen would only say
 * "Could not connect that mailbox", as though the password were wrong. So routes ask this first
 * and answer plainly: configuration missing on the server is not the person's mistake.
 */
export function credentialsKeyProblem(): string | null {
  try {
    getKey()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'EMAIL_CREDENTIALS_KEY is not usable.'
  }
}

function getKey(): Buffer {
  const key = process.env.EMAIL_CREDENTIALS_KEY
  if (!key) throw new Error('Server is missing EMAIL_CREDENTIALS_KEY configuration.')
  const buf = Buffer.from(key, 'base64')
  if (buf.length !== 32) {
    // The length is worth naming. Buffer.from(..., 'base64') ignores anything that is not a
    // base64 character rather than refusing, so a key generated the wrong way decodes to
    // something plausible-looking and fails here with no hint as to which mistake was made.
    // 48 bytes almost always means `openssl rand -hex 32` — 64 hex characters read as base64.
    // A short count means a passphrase was pasted in instead of a generated key. Reporting the
    // count gives that away; it gives nothing else away, being a length and not the key.
    throw new Error(
      `EMAIL_CREDENTIALS_KEY decodes to ${buf.length} bytes, not 32. `
      + 'Generate one with: openssl rand -base64 32',
    )
  }
  return buf
}

/** Returns "iv.authTag.ciphertext", each base64url, joined with '.'. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decrypt(encoded: string): string {
  const [ivPart, tagPart, dataPart] = encoded.split('.')
  if (!ivPart || !tagPart || !dataPart) throw new Error('Malformed encrypted value.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8')
}

/**
 * A keyed one-way hash (HMAC-SHA256 with the same key), for things that are only ever compared --
 * a client portal's sign-in codes and session tokens (Raptor's keyedHash). `purpose` keeps a code
 * and a token from ever hashing alike.
 */
export function keyedHash(purpose: string, value: string): string {
  return crypto.createHmac('sha256', getKey()).update(`${purpose}:${value}`).digest('hex')
}

/** Equal hex strings, in constant time, so a wrong code is not refused faster than a near one. */
export function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y)
}

/*
 * A PORTAL PASSWORD (Remus · Handover 8, copied from Raptor S16's api/_lib/crypto.ts). scrypt, salted per login,
 * over the keyed hash of the password -- so a leaked table is useless without the server key as well, and
 * expensive with it. Stored as "scrypt$N$r$p$salt$hash". Never the password as typed.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const out = crypto.scryptSync(keyedHash('portal-password', password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), out.toString('base64')].join('$')
}

export function passwordMatches(password: string, stored: string | null | undefined): boolean {
  const parts = (stored ?? '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, hash] = parts
  const want = Buffer.from(hash, 'base64')
  /* Only the costs this file writes: a stored row is the server's own, but a forged N would be a way to stall it. */
  if (Number(n) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p || want.length === 0) return false
  const got = crypto.scryptSync(keyedHash('portal-password', password), Buffer.from(salt, 'base64'), want.length,
    { N: Number(n), r: Number(r), p: Number(p) })
  return crypto.timingSafeEqual(want, got)
}
