/**
 * Bank statement import: CSV (FNB, ABSA, Standard Bank, Nedbank, Capitec and anything with a
 * header row) and OFX. Pure functions, no I/O: the page reads the file and hands the text here.
 *
 * SA bank exports differ in small, annoying ways: FNB puts a few preamble lines above the header,
 * some banks use ';' as the delimiter, Standard Bank uses yyyymmdd dates, some export debit and
 * credit in separate columns, and amounts may carry "R", spaces, thousands commas, "Cr"/"Dr" or
 * parentheses. Capitec adds a separate Fee column; some exports have an unsigned Amount plus a
 * D/C indicator column; Standard Bank's "HIST," export has no header row at all. The importer finds
 * the header row (or numbers the columns), guesses a mapping, and lets the user correct it.
 */
import type { CsvMapping } from '../types'

/** The stored mapping plus the optional extras: Capitec fee column, D/C sign indicator column. */
export interface BankCsvMapping extends CsvMapping {
  /** Bank charges in their own column; always money out, added to the debit. */
  fee?: string
  /** Unsigned Amount column with a separate "D"/"C" (DR/CR, Debit/Credit) indicator. */
  signColumn?: string
}

export interface ParsedTable {
  headers: string[]
  rows: string[][]
  /** Line index of the header row in the original file (preamble lines skipped). */
  headerIndex: number
}

export interface ParsedTransaction {
  date: string // yyyy-mm-dd
  description: string
  amount: number // negative = money out
  balance: number | null
  reference: string | null
  external_id: string
}

export interface ParseResult {
  transactions: ParsedTransaction[]
  errors: { line: number; message: string }[]
  /** Rows deliberately left out: zero amounts, opening/closing balance lines, blank footers. */
  skipped: number
}

// ---------- Low-level CSV ----------

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n')
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  for (const ch of sample) if (ch in counts) counts[ch]++
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return n > 0 ? best : ','
}

/** RFC-4180-ish: quoted fields, doubled quotes, embedded newlines, BOM. */
export function parseCsvRows(text: string, delimiter?: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const delim = delimiter ?? detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    // A quote only opens a quoted field at the start of the field; inside one (12" PIPE) it's literal.
    if (ch === '"' && field.trim() === '') {
      quoted = true
      field = ''
    }
    else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\r') continue
    else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.map((r) => r.map((c) => c.trim()))
}

const HEADER_HINTS = /date|description|amount|balance|debit|credit|details|narrative|reference|transaction/i

/** True when some cell is a date or an amount, i.e. the row is data, not column names. */
function hasValues(r: string[]): boolean {
  return r.some((c) => c !== '' && (parseBankDate(c) !== null || parseAmount(c) !== null))
}

/**
 * Finds the header row: the first row with 3+ cells where at least two look like column names and
 * none is a date or an amount (so "2026/10/01,Transaction fee,..." is never taken as the header).
 * A first row of plain labels directly above a dated row also counts. Without a header (Standard
 * Bank "HIST,20261001,,-1250.00,...") the columns are named "Column N" and every row is data.
 */
export function parseBankTable(text: string): ParsedTable {
  const all = parseCsvRows(text)
  const nonEmpty = (r: string[]) => r.filter((c) => c !== '').length
  let headerIndex = all.findIndex((r) => nonEmpty(r) >= 3 && r.filter((c) => HEADER_HINTS.test(c)).length >= 2 && !hasValues(r))
  if (headerIndex < 0 && all.length > 1 && nonEmpty(all[0]) >= 3 && !hasValues(all[0]) && all[1].some((c) => parseBankDate(c) !== null)) headerIndex = 0
  if (headerIndex < 0) {
    const rows = all.filter((r) => r.some((c) => c !== ''))
    const width = Math.max(0, ...rows.map((r) => r.length))
    return { headers: Array.from({ length: width }, (_, i) => `Column ${i + 1}`), rows, headerIndex: -1 }
  }
  const headers = (all[headerIndex] ?? []).map((h, i) => h || `Column ${i + 1}`)
  const rows = all.slice(headerIndex + 1).filter((r) => r.some((c) => c !== ''))
  return { headers, rows, headerIndex }
}

// ---------- Mapping ----------

function findHeader(headers: string[], patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const h = headers.find((x) => p.test(x))
    if (h) return h
  }
  return undefined
}

const SIGN_HEADER = /^(dr\s*\/\s*cr|cr\s*\/\s*dr|d\s*\/\s*c|c\s*\/\s*d|debit\s*\/\s*credit|credit\s*\/\s*debit|sign|indicator)$/i

/**
 * Header-less files: which column holds dates, amounts and text, judged from the first rows. The
 * first amount-like column (with cents) is the amount, the last one the running balance; the
 * description is the text column with the most distinct values (skipping constant "HIST" markers).
 */
function inferColumns(headers: string[], rows: string[][]): { date?: string; description?: string; amount?: string; balance?: string } {
  const sample = rows.slice(0, 50)
  if (!sample.length) return {}
  const half = sample.length / 2
  const cols = headers.map((h, i) => {
    const cells = sample.map((r) => r[i] ?? '').filter((c) => c !== '')
    return {
      h,
      dates: cells.filter((c) => parseBankDate(c) !== null).length,
      amounts: cells.filter((c) => /\d[.,]\d{2}\b/.test(c) && parseAmount(c) !== null).length,
      texts: cells.filter((c) => /[A-Za-z]{3}/.test(c) && parseBankDate(c) === null).length,
      distinct: new Set(cells).size,
    }
  })
  const date = [...cols].sort((a, b) => b.dates - a.dates).find((c) => c.dates >= half)?.h
  const amounts = cols.filter((c) => c.h !== date && c.amounts >= half)
  const description = cols
    .filter((c) => c.h !== date && c.texts >= half && c.distinct > 1)
    .sort((a, b) => b.distinct - a.distinct)[0]?.h
  return { date, description, amount: amounts[0]?.h, balance: amounts.length > 1 ? amounts[amounts.length - 1].h : undefined }
}

/**
 * Best guess at which columns hold what, from common SA bank header names. Pass the data rows too
 * so a header-less file ("Column 1", "Column 2"...) can be guessed from its contents.
 */
export function guessMapping(headers: string[], rows: string[][] = []): BankCsvMapping {
  const inferred = inferColumns(headers, rows)
  const date = findHeader(headers, [/^date$/i, /transaction date/i, /posting date/i, /value date/i, /date/i]) ?? inferred.date ?? headers[0] ?? ''
  const description =
    findHeader(headers, [/^description$/i, /description/i, /details/i, /narrative/i, /transaction$/i, /particulars/i]) ??
    inferred.description ??
    headers[1] ??
    ''
  // "Debit/Credit" is an indicator column, not the debit or credit amount.
  const signColumn = findHeader(headers, [SIGN_HEADER])
  const rest = headers.filter((h) => h !== signColumn)
  const debit = findHeader(rest, [/debit/i, /money out/i, /withdrawal/i])
  const credit = findHeader(rest, [/credit/i, /money in/i, /deposit/i])
  const fee = findHeader(rest, [/^fee/i])
  const useDebitCredit = !!(debit && credit)
  const amount =
    findHeader(
      rest.filter((h) => h !== debit && h !== credit && h !== fee),
      [/^amount$/i, /amount/i, /^value$/i],
    ) ?? (useDebitCredit ? undefined : inferred.amount)
  const balance = findHeader(headers, [/balance/i]) ?? (inferred.balance !== amount ? inferred.balance : undefined)
  const reference = findHeader(headers, [/reference/i, /^ref/i])
  const debitCredit = !amount && useDebitCredit
  return {
    date,
    description,
    amount: debitCredit ? undefined : amount,
    debit: debitCredit ? debit : undefined,
    credit: debitCredit ? credit : undefined,
    fee,
    signColumn: !debitCredit && amount ? signColumn : undefined,
    balance,
    reference: reference && reference !== description ? reference : undefined,
    dateFormat: 'auto',
  }
}

// ---------- Values ----------

/** "R", "ZAR" in front of the number (after an optional sign): "R -1 234.56", "-R50", "ZAR 10". */
const CURRENCY_PREFIX = /^([-+]?)\s*(?:ZAR|R)(?=[\s\d.,(+-])\s*/i

/**
 * "R -1 234.56", "1,234.56", "(1234.56)", "1234.56 Dr", "1234.56CR", "-1234,56", "1.234,56",
 * "−50.00" (Unicode minus) all become numbers. A lone comma followed by exactly two digits at the
 * end is treated as a decimal comma.
 */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  let s = String(raw).replace(/\u2212/g, '-').trim()
  if (!s) return null
  let negative = false
  const suffix = /\s*(cr|dr)\.?$/i.exec(s)
  if (suffix) {
    if (suffix[1].toLowerCase() === 'dr') negative = true
    s = s.slice(0, suffix.index)
  }
  s = s.replace(CURRENCY_PREFIX, '$1')
  if (/^\(.*\)$/.test(s)) {
    negative = !negative
    s = s.slice(1, -1).replace(CURRENCY_PREFIX, '$1')
  }
  s = s.replace(/\s/g, '')
  if (s.endsWith('-')) {
    negative = !negative
    s = s.slice(0, -1)
  }
  if (/^-?\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d+,\d{2}$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (!/\d/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -Math.abs(n) : n
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function valid(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * Returns yyyy-mm-dd or null. Day-first is assumed for ambiguous dates (SA convention). Year-first
 * dates are recognised whatever the format setting, so 'ymd' (older saved mappings) means auto.
 */
export function parseBankDate(raw: string, fmt: CsvMapping['dateFormat'] = 'auto'): string | null {
  const s = raw.trim()
  if (!s) return null
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])
  // "03 Oct 2026", "3-Oct-26", "01Oct2026"
  m = /^(\d{1,2})[-/.\s]?([A-Za-z]{3})[A-Za-z]*\.?[-/.,\s]*(\d{4}|\d{2})(?!\d)/.exec(s)
  if (m && MONTHS[m[2].toLowerCase()]) return valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1])
  // "Oct 01 2026", "October 1, 2026"
  m = /^([A-Za-z]{3})[A-Za-z]*\.?[-/.\s]*(\d{1,2})(?:st|nd|rd|th)?[-/.,\s]+(\d{4})(?!\d)/.exec(s)
  if (m && MONTHS[m[1].toLowerCase()]) return valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    const y = +m[3]
    if (fmt === 'mdy') return valid(y, a, b)
    return valid(y, b, a) ?? (fmt === 'dmy' ? null : valid(y, a, b))
  }
  return null
}

/** Small, stable, synchronous string hash (cyrb53). Good enough for dedupe keys. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Dedupe key: date + amount + normalised description (not the reference, which some banks fill in
 * differently between exports of the same statement).
 */
export function transactionKey(date: string, amount: number, description: string, prefix = 'csv'): string {
  const norm = description.toUpperCase().replace(/\s+/g, ' ').trim()
  return `${prefix}:${hashString(`${date}|${amount.toFixed(2)}|${norm}`)}`
}

/** Two identical rows on one statement (two R50 tolls on one day) are real, not duplicates. */
function uniqueKeys() {
  const seen = new Map<string, number>()
  return (key: string) => {
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    return count > 0 ? `${key}-${count}` : key
  }
}

// ---------- Apply mapping ----------

/** Opening/closing balance and brought/carried forward lines carry a balance, not a transaction. */
const BALANCE_LINE = /\b(opening|closing) balance\b|\bbalance (brought|carried) (forward|fwd)\b|^(b\/f|c\/f)\b/i

/** Empty, or a placeholder dash. */
const blank = (s: string) => /^[-\u2013\u2014\s]*$/.test(s)

export function applyMapping(table: ParsedTable, mapping: BankCsvMapping): ParseResult {
  const idx = (name?: string) => (name ? table.headers.indexOf(name) : -1)
  const iDate = idx(mapping.date)
  const iDesc = idx(mapping.description)
  const iAmt = idx(mapping.amount)
  const iDebit = idx(mapping.debit)
  const iCredit = idx(mapping.credit)
  const iFee = idx(mapping.fee)
  const iSign = idx(mapping.signColumn)
  const iBal = idx(mapping.balance)
  const iRef = idx(mapping.reference)
  const transactions: ParsedTransaction[] = []
  const errors: ParseResult['errors'] = []
  let skipped = 0
  const unique = uniqueKeys()

  table.rows.forEach((row, n) => {
    const line = table.headerIndex + 2 + n
    const cell = (i: number) => (i >= 0 ? row[i] ?? '' : '')
    if (row.some((c) => BALANCE_LINE.test(c))) {
      skipped++
      return
    }
    const date = iDate >= 0 ? parseBankDate(cell(iDate), mapping.dateFormat) : null
    if (!date) {
      // Footer lines (blank totals) are common; only report rows with content.
      if (row.filter((c) => c).length >= 2) errors.push({ line, message: `Unreadable date "${cell(iDate)}"` })
      else skipped++
      return
    }
    // Each mapped amount cell must be blank or a number; blank counts as zero.
    const read = (i: number): number | null => (blank(cell(i)) ? 0 : parseAmount(cell(i)))
    let amount: number | null = null
    if (iAmt >= 0) {
      amount = read(iAmt)
      if (amount !== null && iSign >= 0) {
        const sign = cell(iSign).trim().replace(/\.$/, '').toLowerCase()
        if (sign === 'd' || sign === 'dr' || sign === 'debit') amount = -Math.abs(amount)
        else if (sign === 'c' || sign === 'cr' || sign === 'credit') amount = Math.abs(amount)
      } else if (amount !== null && mapping.invertSign) amount = -amount
    } else if (iDebit >= 0 || iCredit >= 0) {
      const debit = read(iDebit)
      const credit = read(iCredit)
      amount = debit === null || credit === null ? null : Math.abs(credit) - Math.abs(debit)
    }
    const fee = read(iFee)
    if (amount === null || fee === null || !Number.isFinite(amount)) {
      errors.push({ line, message: 'Unreadable amount' })
      return
    }
    amount = Math.round((amount - Math.abs(fee)) * 100) / 100
    if (amount === 0) {
      skipped++
      return
    }
    const description = cell(iDesc)
    const reference = cell(iRef) || null
    transactions.push({
      date,
      description,
      amount,
      balance: iBal >= 0 ? parseAmount(cell(iBal)) : null,
      reference,
      external_id: unique(transactionKey(date, amount, description)),
    })
  })
  return { transactions, errors, skipped }
}

// ---------- OFX ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** OFX text is SGML/XML-escaped: "BUILDERS &amp; CO", "&#39;". */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : all
    }
    return ENTITIES[e.toLowerCase()] ?? all
  })
}

function ofxTag(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block)
  return m ? decodeEntities(m[1]).trim() : null
}

/** SAST, the local time bank lines are reconciled in. */
const SA_OFFSET_HOURS = 2

/**
 * OFX dates: yyyymmdd[hhmmss[.xxx]][[offset:TZ]]. With an explicit offset ("[0:GMT]",
 * "[-5:EST]") the instant is converted to the SA calendar date; without one the date is taken as
 * written (SA banks export local dates).
 */
export function parseOfxDate(raw: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?(?:\.\d+)?\s*(?:\[\s*([+-]?\d+(?:\.\d+)?)\s*(?::[^\]]*)?\])?/.exec(raw.trim())
  if (!m) return null
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  if (!valid(y, mo, d)) return null
  if (m[7] === undefined) return valid(y, mo, d)
  const utc = Date.UTC(y, mo - 1, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) - Number(m[7]) * 3_600_000
  const sa = new Date(utc + SA_OFFSET_HOURS * 3_600_000)
  return valid(sa.getUTCFullYear(), sa.getUTCMonth() + 1, sa.getUTCDate())
}

/** Minimal OFX (SGML or XML) reader: STMTTRN blocks only. */
export function parseOfx(text: string): ParseResult {
  const transactions: ParsedTransaction[] = []
  const errors: ParseResult['errors'] = []
  let skipped = 0
  const unique = uniqueKeys()
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  blocks.forEach((raw, n) => {
    const block = raw.split(/<\/STMTTRN>/i)[0]
    const dt = ofxTag(block, 'DTPOSTED')
    const amt = parseAmount(ofxTag(block, 'TRNAMT'))
    const date = dt ? parseOfxDate(dt) : null
    if (!date || amt === null) {
      errors.push({ line: n + 1, message: 'Unreadable OFX transaction' })
      return
    }
    const amount = Math.round(amt * 100) / 100
    if (amount === 0) {
      skipped++
      return
    }
    const name = ofxTag(block, 'NAME') ?? ''
    const memo = ofxTag(block, 'MEMO') ?? ''
    const description = [name, memo].filter(Boolean).join(' ').trim()
    const fitid = ofxTag(block, 'FITID')
    transactions.push({
      date,
      description,
      amount,
      balance: null,
      reference: ofxTag(block, 'REFNUM') || ofxTag(block, 'CHECKNUM') || null,
      external_id: unique(fitid ? `ofx:${fitid}` : transactionKey(date, amount, description, 'ofxkey')),
    })
  })
  return { transactions, errors, skipped }
}

export function looksLikeOfx(text: string): boolean {
  return /<OFX>|OFXHEADER/i.test(text.slice(0, 2000))
}
