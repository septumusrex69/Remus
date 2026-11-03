import { beforeAll, describe, expect, it } from 'vitest'
import { hashPassword, passwordMatches } from './crypto.js'

describe('portal passwords are kept only as a salted scrypt (Remus · Handover 8, Raptor S16)', () => {
  beforeAll(() => { process.env.EMAIL_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64') })

  it('never the password itself, and a new salt every time', () => {
    const a = hashPassword('the green gate')
    const b = hashPassword('the green gate')
    expect(a).not.toContain('the green gate')
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/)
    expect(a).not.toBe(b)
  })
  it('the right password matches; a wrong one, an empty store or a forged cost does not', () => {
    const stored = hashPassword('the green gate')
    expect(passwordMatches('the green gate', stored)).toBe(true)
    expect(passwordMatches('the green gatE', stored)).toBe(false)
    expect(passwordMatches('the green gate', null)).toBe(false)
    expect(passwordMatches('the green gate', 'plain text')).toBe(false)
    expect(passwordMatches('the green gate', stored.replace('$16384$', '$1048576$'))).toBe(false)
  })
})
