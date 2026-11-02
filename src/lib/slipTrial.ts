/**
 * THE SLIP READER'S SIDE-BY-SIDE TEST, SCORED (Remus · Handover 7). Each trial slip was read by the first reader
 * (Sonnet) and the new one (Haiku); once someone has typed what is really on the slip (`truth`), each reader is
 * right or wrong per field. Until then the two are only compared with each other.
 */

export const SLIP_TRIAL_FIELDS = ['supplier', 'date', 'slip_number', 'total_incl', 'vat'] as const
export type SlipTrialField = (typeof SLIP_TRIAL_FIELDS)[number]
export const FIELD_LABEL: Record<SlipTrialField, string> = {
  supplier: 'Supplier', date: 'Date', slip_number: 'Slip number', total_incl: 'Total', vat: 'VAT',
}

type Value = string | number | null | undefined

/** Letters and digits only, lower case: "CASHBUILD (Pty) Ltd." and "Cashbuild" compare on their words. */
const words = (v: Value) => String(v ?? '').toLowerCase().replace(/\(pty\)|\bltd\b|\bpty\b/g, '').replace(/[^a-z0-9]/g, '')

/** Is what a reader read the same as the truth (or the other reader)? Nothing read matches only nothing. */
export function sameValue(field: SlipTrialField, a: Value, b: Value): boolean {
  const blankA = a === null || a === undefined || a === ''
  const blankB = b === null || b === undefined || b === ''
  if (blankA || blankB) return blankA && blankB
  if (field === 'total_incl' || field === 'vat') return Math.abs(Number(a) - Number(b)) < 0.005
  if (field === 'supplier') {
    const x = words(a)
    const y = words(b)
    return x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)))
  }
  if (field === 'slip_number') {
    const bare = (v: Value) => words(v).replace(/(^|[a-z])0+(?=\d)/g, '$1')
    return bare(a) === bare(b)
  }
  return String(a).trim() === String(b).trim()
}

export interface TrialLike {
  old_result: { extraction?: Partial<Record<SlipTrialField, Value>> | null; error?: string } | null
  new_result: { extraction?: Partial<Record<SlipTrialField, Value>> | null; error?: string } | null
  truth: Partial<Record<SlipTrialField, Value>> | null
  old_usd: number | string | null
  new_usd: number | string | null
}

export interface FieldScore { field: SlipTrialField; checked: number; oldRight: number; newRight: number; agree: number; compared: number }
export interface TrialSummary {
  slips: number
  checked: number
  fields: FieldScore[]
  oldUsdPerSlip: number
  newUsdPerSlip: number
}

/** Per field: of the slips checked against the truth, how many each reader got right; and how often they agreed. */
export function summariseTrials(trials: TrialLike[]): TrialSummary {
  const fields: FieldScore[] = SLIP_TRIAL_FIELDS.map((field) => ({ field, checked: 0, oldRight: 0, newRight: 0, agree: 0, compared: 0 }))
  let checked = 0
  let oldUsd = 0
  let newUsd = 0
  for (const t of trials) {
    oldUsd += Number(t.old_usd) || 0
    newUsd += Number(t.new_usd) || 0
    const o = t.old_result?.extraction ?? {}
    const n = t.new_result?.extraction ?? {}
    const truth = t.truth && Object.keys(t.truth).length ? t.truth : null
    if (truth) checked += 1
    for (const f of fields) {
      f.compared += 1
      if (sameValue(f.field, o[f.field], n[f.field])) f.agree += 1
      if (truth && f.field in truth) {
        f.checked += 1
        if (sameValue(f.field, o[f.field], truth[f.field])) f.oldRight += 1
        if (sameValue(f.field, n[f.field], truth[f.field])) f.newRight += 1
      }
    }
  }
  const count = trials.length || 1
  return { slips: trials.length, checked, fields, oldUsdPerSlip: oldUsd / count, newUsdPerSlip: newUsd / count }
}
