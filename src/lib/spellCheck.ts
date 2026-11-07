/**
 * SPELL CHECK, ON UNLESS YOU SWITCH IT OFF (Remus · Handover 8, 7 Nov 2026). Copied from Raptor's spellCheck.ts
 * (Raptor · Handover 17, S18, 6 Nov). Stephan, 7 Nov, on what Raptor has that Remus does not: "We can like start with
 * pretty much all of that." Stephan on Raptor: "we can do number 1 and 2. But also there should be an option to switch
 * it off ... by default it's on, but the user can switch it off." So, two things, one switch:
 *
 *   1. THE BROWSER'S UNDERLINES, asked for everywhere somebody types (the `spellcheck` attribute on <html>, which
 *      every box inherits), with the page declared South African English in index.html.
 *   2. A CHECK BEFORE AN EMAIL GOES TO A CLIENT: it is read against a British English dictionary (Hunspell en_GB-ise,
 *      the spelling South Africa writes) before it leaves, and the words it does not know are shown with
 *      suggestions. Sending anyway is always one press -- this catches typos, it does not hold mail.
 *
 * NOTHING LEAVES THE BROWSER. Raptor turned a grammar service down: a client's words are personal information, and
 * sending them to a third party to be proof-read is a POPIA question nobody needs to answer.
 *
 * WHAT IT DOES NOT CHECK, ON PURPOSE -- a warning that fires when nothing is wrong is worse than none:
 *   - any word with a capital letter in it: names, places, suppliers, acronyms (VAT, JBCC, NHBRC). The cost is that a
 *     typo in the first word of a sentence goes unflagged; the browser's underline still catches it.
 *   - anything with a digit, a merge field ({{name}}), an email address or a web address.
 *   - the firm's own words (FIRM_WORDS) and the words this person added ("Add to my words", kept on this device).
 *
 * DIFFERENT FROM RAPTOR: the firm's words are a builder's, not a debt collector's, and Remus has no SMS box, so the
 * check sits on the email composer only. The switch lives on Settings -> Appearance, as in Raptor.
 *
 * PURE where it can be: tokens() and unknownWords() take the speller as an argument, so spellCheck.test.ts can hold
 * them without a browser. loadSpeller() is the only part that fetches.
 */

const SWITCH_KEY = 'remus.spellCheck'
const MY_WORDS_KEY = 'remus.spellCheck.myWords'

/** On unless this person switched it off on this device. */
export function spellCheckEnabled(): boolean {
  try { return window.localStorage.getItem(SWITCH_KEY) !== 'off' } catch { return true }
}

export function setSpellCheckEnabled(on: boolean) {
  try { window.localStorage.setItem(SWITCH_KEY, on ? 'on' : 'off') } catch { /* the choice lasts this visit */ }
  applySpellCheckAttribute()
}

/** The browser's underlines follow the switch: every text box inherits it from <html>. */
export function applySpellCheckAttribute() {
  try { document.documentElement.setAttribute('spellcheck', spellCheckEnabled() ? 'true' : 'false') } catch { /* no DOM */ }
}

/*
 * THE FIRM'S OWN WORDS -- lower case, because capitalised words are never checked. Building words and South African
 * words a British dictionary does not carry. Add to it rather than teaching people to ignore the panel.
 */
export const FIRM_WORDS: readonly string[] = [
  // the trade
  'screed', 'screeding', 'skimming', 'skim', 'dpc', 'dpm', 'brickforce', 'lintel', 'lintels', 'formwork', 'shuttering',
  'rebar', 'mesh', 'ibr', 'fascia', 'fascias', 'soffit', 'soffits', 'eave', 'eaves', 'gutters', 'downpipe', 'downpipes',
  'plasterboard', 'drywall', 'cornice', 'cornices', 'skirting', 'skirtings', 'grout', 'grouting', 'tiler', 'tilers',
  'waterproofing', 'torchon', 'sealant', 'sealants', 'retaining', 'subcontractor', 'subcontractors',
  'snag', 'snags', 'snagging', 'snaglist', 'handover', 'handovers', 'quantities', 'boq', 'variation', 'variations',
  'prelims', 'preliminaries', 'labour', 'invoiced', 'invoicing', 'deposit', 'retention', 'retentions',
  'rand', 'rands', 'cents', 'eft', 'efts', 'vat', 'ito', 'per', 'qty', 'sqm', 'lm',
  // how people write here
  'whatsapp', 'email', 'emails', 'emailed', 'emailing', 'sms', 'ok', 'okay', 'dear', 'kindly', 'regards',
  'braai', 'bakkie', 'bakkies', 'robot', 'robots', 'stoep', 'stoeps', 'ja', 'nee', 'baie', 'dankie', 'sawubona', 'molo',
  'ngiyabonga', 'enkosi', 'thobela', 'dumela', 'lekker', 'eish', 'howzit', 'shame',
]

export function myWords(): string[] {
  try { return JSON.parse(window.localStorage.getItem(MY_WORDS_KEY) ?? '[]') as string[] } catch { return [] }
}
export function addMyWord(word: string) {
  const w = word.trim().toLowerCase()
  if (!w) return
  try {
    const next = Array.from(new Set([...myWords(), w])).sort()
    window.localStorage.setItem(MY_WORDS_KEY, JSON.stringify(next))
  } catch { /* nowhere to keep it */ }
}

/** The words of a message that are worth checking, each once, in the order they first appear. */
export function tokens(text: string): string[] {
  const cleaned = text
    .replace(/\{\{[^}]*\}\}/g, ' ')                       // merge fields
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')         // web addresses
    .replace(/\S+@\S+/g, ' ')                             // email addresses
    .replace(/[‘’ʼ]/g, "'")                // curly apostrophes read as straight ones
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of cleaned.matchAll(/[A-Za-zÀ-ɏ0-9']+/g)) {
    const w = m[0].replace(/^'+|'+$/g, '')
    if (w.length < 2) continue
    if (/[0-9]/.test(w)) continue                         // amounts, dates, references
    if (/[A-ZÀ-Þ]/.test(w)) continue            // names, places, acronyms -- see the header
    if (seen.has(w)) continue
    seen.add(w)
    out.push(w)
  }
  return out
}

export interface Speller {
  correct(word: string): boolean
  suggest(word: string): string[]
}

export interface Unknown { word: string; suggestions: string[] }

/** The words the dictionary, the firm's list and this person's own words all do not know. */
export function unknownWords(text: string, speller: Speller, extra: Iterable<string> = []): Unknown[] {
  const known = new Set([...FIRM_WORDS, ...extra].map((w) => w.toLowerCase()))
  const out: Unknown[] = []
  for (const w of tokens(text)) {
    if (known.has(w)) continue
    /* A possessive the dictionary lacks is read without its ending: "client's", "builder's". */
    const bare = w.replace(/'s$/, '')
    if (known.has(bare) || speller.correct(w) || speller.correct(bare)) continue
    out.push({ word: w, suggestions: speller.suggest(w).slice(0, 3) })
  }
  return out
}

/** Every whole-word occurrence of `word` in `text` swapped for `by` -- what a suggestion's press does. */
export function replaceWord(text: string, word: string, by: string): string {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(?<![A-Za-z\\u00c0-\\u024f'])${esc}(?![A-Za-z\\u00c0-\\u024f'])`, 'g'), by)
}

/*
 * THE DICTIONARY, FETCHED THE FIRST TIME SOMEBODY SENDS -- about 550 kB, which nobody who only reads the diary should
 * download. Hunspell's en_GB-ise from wordlist.sourceforge.net (the npm package dictionary-en-gb), served from
 * public/dictionaries/en-gb with its licence beside it; nspell builds the speller once per visit.
 */
const DICTIONARY = '/dictionaries/en-gb/'
let speller: Promise<Speller> | null = null
export function loadSpeller(): Promise<Speller> {
  if (!speller) {
    speller = (async () => {
      const [{ default: nspell }, aff, dic] = await Promise.all([
        import('nspell'),
        fetch(DICTIONARY + 'en_GB.aff').then((r) => { if (!r.ok) throw new Error('dictionary'); return r.text() }),
        fetch(DICTIONARY + 'en_GB.dic').then((r) => { if (!r.ok) throw new Error('dictionary'); return r.text() }),
      ])
      return nspell(aff, dic) as Speller
    })()
    speller.catch(() => { speller = null })              // a failed fetch is tried again next time
  }
  return speller
}
