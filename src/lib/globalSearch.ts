/**
 * THE TOP BAR'S SEARCH, OVER EVERYTHING (Remus · Handoff 5, after Raptor H13's lib/globalSearch.ts).
 *
 * Raptor's firm, 27 Oct: "You should be able to search on a surname, on a telephone number ... on a
 * reference number ... all of the data, it should be searchable ... if it doesn't affect the speed."
 *
 * Remus's box searched clients, people, projects and quotes by name only. Now it also finds them by
 * email and phone, and finds invoices (INV-0003), change requests (R-6), workers and subcontractors.
 * Raptor needs a database search for its debtor book (too big for the browser); Remus's whole book
 * fits in the browser, so it stays here, fetched the first time the box is used.
 *
 * A phone number is matched on its digits, in both the 0... and 27... forms, so "082 123 4567",
 * "0821234567" and "+27 82 123 4567" all find the same person.
 */

/** The digits of a phone number in every form it is written: 0821234567 <-> 27821234567. */
export function phoneForms(value: string | null | undefined): string[] {
  const d = (value ?? '').replace(/\D/g, '')
  if (d.length < 6) return d ? [d] : []
  if (d.startsWith('27') && d.length >= 11) return [d, `0${d.slice(2)}`]
  if (d.startsWith('0')) return [d, `27${d.slice(1)}`]
  return [d]
}

/**
 * Does what was typed appear in any of these fields? Words are matched in any order ("smith john"
 * finds John Smith); a number of six digits or more is also matched against every phone form.
 */
export function matchesAny(fields: (string | null | undefined)[], typed: string): boolean {
  const q = typed.trim().toLowerCase()
  if (!q) return false
  const text = fields.filter(Boolean).join(' ').toLowerCase()
  if (text.includes(q)) return true
  const words = q.split(/\s+/).filter(Boolean)
  if (words.length > 1 && words.every((w) => text.includes(w))) return true
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 6) {
    const forms = fields.flatMap((f) => phoneForms(f))
    const typedForms = phoneForms(digits)
    return forms.some((f) => typedForms.some((t) => f.includes(t)))
  }
  return false
}

/** "R-6", "r6", "R 6": a change request's number, else null. */
export function requestNumberOf(typed: string): number | null {
  const m = /^r\s*-?\s*(\d+)$/i.exec(typed.trim())
  return m ? Number(m[1]) : null
}
