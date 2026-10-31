import { REMUS_OPENING_DEFAULT, type RemusVariant } from './RemusOpening'

/*
 * Which opening plays after a sign-in on this device. DIFFERENT FROM RAPTOR (which plays one, chosen in code): Stephan
 * asked for several, so the /opening page has "Play this one when I sign in", remembered per device like the folded
 * sidebar. Nothing chosen: REMUS_OPENING_DEFAULT.
 */
const KEY = 'remus.opening'
const ALL: RemusVariant[] = ['stamp', 'slash', 'cut', 'pour']

export function chosenOpening(): RemusVariant {
  try {
    const v = localStorage.getItem(KEY) as RemusVariant | null
    return v && ALL.includes(v) ? v : REMUS_OPENING_DEFAULT
  } catch { return REMUS_OPENING_DEFAULT }
}

export function chooseOpening(v: RemusVariant): void {
  try { localStorage.setItem(KEY, v) } catch { /* private window: the default plays */ }
}
