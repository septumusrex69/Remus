/**
 * THE PORTAL PASSWORD'S RULE, FOR THE BROWSER (Remus · Handover 8, Raptor S16). The same rule as the server's
 * (api/_lib/portalRules.ts portalPasswordProblem; src cannot import api, so it is written twice and
 * portalPassword.test.ts holds the two equal). The page says it before sending; the server is what enforces it.
 */
export const PORTAL_PASSWORD_MIN = 8

/** Why a chosen password will not do, in words for the client; null when it will. */
export function portalPasswordProblem(password: unknown, email: string | null): string | null {
  if (typeof password !== 'string' || password.length < PORTAL_PASSWORD_MIN) return `Use at least ${PORTAL_PASSWORD_MIN} characters.`
  if (password.length > 200) return 'That is longer than a password needs to be.'
  if (/^(.)\1*$/.test(password)) return 'Use more than one character, repeated.'
  if (email && password.trim().toLowerCase() === email.toLowerCase()) return 'Use something other than your email address.'
  return null
}
