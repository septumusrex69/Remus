import { describe, expect, it } from 'vitest'
import { PORTAL_PASSWORD_MIN, portalPasswordProblem } from './portalPassword'
import { PORTAL_PASSWORD_MIN as SERVER_MIN, portalPasswordProblem as serverProblem } from '../../api/_lib/portalRules'

describe('the portal password rule, browser and server alike', () => {
  const tries: [unknown, string | null][] = [
    ['', null], ['short', null], ['aaaaaaaaaa', null], ['jan@build.co.za', 'jan@build.co.za'], [' Jan@Build.co.za ', 'jan@build.co.za'],
    ['the green gate on Main', 'jan@build.co.za'], ['x'.repeat(201), null], [12345678, null],
  ]
  it('says the same as the server for every try', () => {
    expect(PORTAL_PASSWORD_MIN).toBe(SERVER_MIN)
    for (const [pw, email] of tries) expect(portalPasswordProblem(pw, email)).toBe(serverProblem(pw, email))
  })
  it('a phrase will do; short, one letter repeated or the address will not', () => {
    expect(portalPasswordProblem('the green gate on Main', 'jan@build.co.za')).toBe(null)
    expect(portalPasswordProblem('short', null)).toMatch(/at least 8/)
    expect(portalPasswordProblem('aaaaaaaaaa', null)).toMatch(/more than one character/)
    expect(portalPasswordProblem('jan@build.co.za', 'jan@build.co.za')).toMatch(/other than your email/)
  })
})
