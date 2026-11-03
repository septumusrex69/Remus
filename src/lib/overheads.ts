/**
 * OVERHEADS, BY KIND (Remus · Handover 8, 3 Nov 2026). Stephan: "you should be able to choose, for example, this is
 * overheads or this is for a job. And if it's overheads, what is the category? ... if it's internet, or if it's car
 * maintenance, so there should be a category for whatever it needs to be as well."
 *
 * A slip is either FOR A JOB (project, stage, and what it was: materials, labour ...) or OVERHEADS (no project, the
 * category 'overheads', and one of the kinds below in expenses.overhead_kind, migration 0039). The kinds are the
 * ones a small South African building firm's books use; "Other" takes the rest, with the description saying what.
 */
export const OVERHEAD_KINDS = [
  { id: 'internet_phone', label: 'Internet & phones' },
  { id: 'vehicle_fuel', label: 'Vehicles: fuel' },
  { id: 'vehicle_maintenance', label: 'Vehicles: maintenance & repairs' },
  { id: 'vehicle_licence_insurance', label: 'Vehicles: licence, insurance & tolls' },
  { id: 'rent', label: 'Rent (office, yard, storage)' },
  { id: 'utilities', label: 'Electricity & water' },
  { id: 'insurance', label: 'Insurance (business)' },
  { id: 'tools_equipment', label: 'Tools & equipment' },
  { id: 'ppe_safety', label: 'Safety gear & PPE' },
  { id: 'software', label: 'Software & subscriptions' },
  { id: 'office', label: 'Office supplies & printing' },
  { id: 'bank_charges', label: 'Bank charges' },
  { id: 'professional', label: 'Accounting, legal & fees' },
  { id: 'marketing', label: 'Advertising & marketing' },
  { id: 'meals', label: 'Meals & refreshments' },
  { id: 'training', label: 'Training & licences' },
  { id: 'other', label: 'Other' },
] as const

export type OverheadKind = (typeof OVERHEAD_KINDS)[number]['id']

export function overheadLabel(kind: string | null | undefined): string {
  return OVERHEAD_KINDS.find((k) => k.id === kind)?.label ?? 'Overheads'
}

/*
 * A FIRST GUESS FROM THE SUPPLIER, so the common slips need no choosing: a fuel station is fuel, a cellphone network is
 * internet & phones, a tyre or service centre is vehicle maintenance. Only a suggestion; the person can change it.
 */
const GUESSES: [RegExp, OverheadKind][] = [
  [/\b(engen|shell|bp|sasol|caltex|astron|total ?energies|puma|fuel|petrol|diesel|garage)\b/i, 'vehicle_fuel'],
  [/\b(vodacom|mtn|telkom|cell ?c|rain|afrihost|webafrica|vox|cool ?ideas|openserve|fibre|internet|airtime|data bundle)\b/i, 'internet_phone'],
  [/\b(tiger ?wheel|supa ?quick|hi-?q|midas|autozone|goldwagen|tyre|tire|service centre|mechanic|panel ?beat|exhaust|auto ?parts)\b/i, 'vehicle_maintenance'],
  [/\b(e-?toll|sanral|toll|licen[cs]e renewal|traffic dept)\b/i, 'vehicle_licence_insurance'],
  [/\b(eskom|city of|municipality|prepaid electricity|water ?&? ?lights)\b/i, 'utilities'],
  [/\b(fnb|absa|nedbank|standard bank|capitec|bank charges?|service fee)\b/i, 'bank_charges'],
  [/\b(microsoft|google|adobe|xero|sage|dropbox|zoom|apple\.com|subscription)\b/i, 'software'],
  [/\b(waltons|pna|stationery|printing|ink|toner|cna)\b/i, 'office'],
  [/\b(wimpy|spur|steers|kfc|mcdonald|nando|debonairs|coffee|restaurant)\b/i, 'meals'],
]

export function guessOverheadKind(...texts: (string | null | undefined)[]): OverheadKind | null {
  const t = texts.filter(Boolean).join(' ')
  if (!t.trim()) return null
  for (const [re, kind] of GUESSES) if (re.test(t)) return kind
  return null
}
