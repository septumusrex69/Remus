/**
 * Bank statement import: CSV (FNB, ABSA, Standard Bank, Nedbank, Capitec and anything with a
 * header row) and OFX. Pure functions, no I/O: the page reads the file and hands the text here.
 *
 * SA bank exports differ in small, annoying ways: FNB puts a few preamble lines above the header,
 * some banks use ';' as the delimiter, Standard Bank uses yyyymmdd dates, some export debit and
 * credit in separate columns, and amounts may carry "R", spaces, thousands commas, "Cr"/"Dr" or
 * parentheses. The importer finds the header row, guesses a mapping, and lets the user correct it.
 */
import type { CsvMapping } from '../types'

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
    if (ch === '"') quoted = true
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

/** Finds the header row: the first row with 3+ cells where at least two look like column names. */
export function parseBankTable(text: string): ParsedTable {
  const all = parseCsvRows(text)
  let headerIndex = all.findIndex((r) => r.filter((c) => c !== '').length >= 3 && r.filter((c) => HEADER_HINTS.test(c)).length >= 2)
  if (headerIndex < 0) headerIndex = 0
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

/** Best guess at which columns hold what, from common SA bank header names. */
export function guessMapping(headers: string[]): CsvMapping {
  const date = findHeader(headers, [/^date$/i, /transaction date/i, /posting date/i, /value date/i, /date/i]) ?? headers[0] ?? ''
  const description =
    findHeader(headers, [/^description$/i, /description/i, /details/i, /narrative/i, /transaction$/i, /particulars/i]) ?? headers[1] ?? ''
  const debit = findHeader(headers, [/debit/i, /money out/i, /withdrawal/i])
  const credit = findHeader(headers, [/credit/i, /money in/i, /deposit/i])
  const amount = findHeader(
    headers.filter((h) => h !== debit && h !== credit),
    [/^amount$/i, /amount/i, /^value$/i],
  )
  const balance = findHeader(headers, [/balance/i])
  const reference = findHeader(headers, [/reference/i, /^ref/i])
  const useDebitCredit = !amount && debit && credit
  return {
    date,
    description,
    amount: useDebitCredit ? undefined : amount,
    debit: useDebitCredit ? debit : undefined,
    credit: useDebitCredit ? credit : undefined,
    balance,
    reference: reference && reference !== description ? reference : undefined,
    dateFormat: 'auto',
  }
}

// ---------- Values ----------

/**
 * "R -1 234.56", "1,234.56", "(1234.56)", "1234.56 Dr", "-1234,56" all become numbers.
 * A lone comma followed by exactly two digits at the end is treated as a decimal comma.
 */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  let s = String(raw).trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/\bdr\b\.?$/i.test(s)) {
    negative = true
    s = s.replace(/\bdr\b\.?$/i, '')
  }
  s = s.replace(/\bcr\b\.?$/i, '')
  s = s.replace(/[R\s ]/g, '')
  if (s.endsWith('-')) {
    negative = !negative
    s = s.slice(0, -1)
  }
  if (/^-?\d+,\d{2}$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  if (s.startsWith('+')) s = s.slice(1)
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

/** Returns yyyy-mm-dd or null. Day-first is assumed for ambiguous dates (SA convention). */
export function parseBankDate(raw: string, fmt: CsvMapping['dateFormat'] = 'auto'): string | null {
  const s = raw.trim()
  if (!s) return null
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.\s]([A-Za-z]{3})[A-Za-z]*[-/.\s](\d{2,4})/.exec(s)
  if (m && MONTHS[m[2].toLowerCase()]) return valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    const y = +m[3]
    if (fmt === 'mdy') return valid(y, a, b)
    if (fmt === 'dmy' || fmt === 'auto') return valid(y, b, a) ?? (fmt === 'auto' ? valid(y, a, b) : null)
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

/** Dedupe key: date + amount + normalised description. */
export function transactionKey(date: string, amount: number, description: string): string {
  const norm = description.toUpperCase().replace(/\s+/g, ' ').trim()
  return `csv:${hashString(`${date}|${amount.toFixed(2)}|${norm}`)}`
}

// ---------- Apply mapping ----------

export function applyMapping(table: ParsedTable, mapping: CsvMapping): ParseResult {
  const idx = (name?: string) => (name ? table.headers.indexOf(name) : -1)
  const iDate = idx(mapping.date)
  const iDesc = idx(mapping.description)
  const iAmt = idx(mapping.amount)
  const iDebit = idx(mapping.debit)
  const iCredit = idx(mapping.credit)
  const iBal = idx(mapping.balance)
  const iRef = idx(mapping.reference)
  const transactions: ParsedTransaction[] = []
  const errors: ParseResult['errors'] = []
  const seen = new Map<string, number>()

  table.rows.forEach((row, n) => {
    const line = table.headerIndex + 2 + n
    const date = iDate >= 0 ? parseBankDate(row[iDate] ?? '', mapping.dateFormat) : null
    if (!date) {
      // Footer lines ("Closing balance", blank totals) are common; only report rows with content.
      if (row.filter((c) => c).length >= 2) errors.push({ line, message: `Unreadable date "${row[iDate] ?? ''}"` })
      return
    }
    let amount: number | null = null
    if (iAmt >= 0) {
      amount = parseAmount(row[iAmt])
      if (amount !== null && mapping.invertSign) amount = -amount
    } else if (iDebit >= 0 || iCredit >= 0) {
      const debit = parseAmount(row[iDebit]) ?? 0
      const credit = parseAmount(row[iCredit]) ?? 0
      amount = Math.abs(credit) - Math.abs(debit)
    }
    if (amount === null || !Number.isFinite(amount)) {
      errors.push({ line, message: 'Unreadable amount' })
      return
    }
    const description = (iDesc >= 0 ? row[iDesc] : '') || ''
    const reference = iRef >= 0 ? row[iRef] || null : null
    let external_id = transactionKey(date, amount, `${description}|${reference ?? ''}`)
    // Two identical rows on one statement (two R50 tolls on one day) are real, not duplicates.
    const count = seen.get(external_id) ?? 0
    seen.set(external_id, count + 1)
    if (count > 0) external_id = `${external_id}-${count}`
    transactions.push({
      date,
      description,
      amount: Math.round(amount * 100) / 100,
      balance: iBal >= 0 ? parseAmount(row[iBal]) : null,
      reference,
      external_id,
    })
  })
  return { transactions, errors }
}

// ---------- OFX ----------

function ofxTag(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block)
  return m ? m[1].trim() : null
}

/** Minimal OFX (SGML or XML) reader: STMTTRN blocks only. */
export function parseOfx(text: string): ParseResult {
  const transactions: ParsedTransaction[] = []
  const errors: ParseResult['errors'] = []
  const blocks = text.split(/<STMTTRN>/i).slice(1)
  blocks.forEach((raw, n) => {
    const block = raw.split(/<\/STMTTRN>/i)[0]
    const dt = ofxTag(block, 'DTPOSTED')
    const amt = parseAmount(ofxTag(block, 'TRNAMT'))
    const date = dt ? parseBankDate(dt.slice(0, 8)) : null
    if (!date || amt === null) {
      errors.push({ line: n + 1, message: 'Unreadable OFX transaction' })
      return
    }
    const name = ofxTag(block, 'NAME') ?? ''
    const memo = ofxTag(block, 'MEMO') ?? ''
    const description = [name, memo].filter(Boolean).join(' ').trim()
    const fitid = ofxTag(block, 'FITID')
    transactions.push({
      date,
      description,
      amount: Math.round(amt * 100) / 100,
      balance: null,
      reference: ofxTag(block, 'REFNUM') ?? ofxTag(block, 'CHECKNUM'),
      external_id: fitid ? `ofx:${fitid}` : transactionKey(date, amt, description),
    })
  })
  return { transactions, errors }
}

export function looksLikeOfx(text: string): boolean {
  return /<OFX>|OFXHEADER/i.test(text.slice(0, 2000))
}
