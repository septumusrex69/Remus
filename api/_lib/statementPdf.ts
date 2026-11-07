import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildStatement, clientPayments, round2, statementFileName,
  type Statement, type StatementInvoice, type StatementPayment,
} from './statement.js'

/**
 * THE STATEMENT OF ACCOUNT AS A PDF (Remus · Handover 8). Stephan, 7 Nov: "Definitely a statement of account."
 *
 * COPIED FROM RAPTOR'S S17 STATEMENT (src/lib/accountSummaryLetter.ts statementOfAccount, drawn by letterPdf.ts):
 * "the statement of account as a statement, on plain paper with the lockup" -- not a letter; "statement head as the
 * firm drew it: a reference block on the right with a rule"; then who the account is and how the balance is made up
 * side by side, every movement with DEBIT / CREDIT / BALANCE (a dash, not R 0.00, in the column a line is not in),
 * the balance in the dark band "where the reader's eye ends up", and how to pay in one box never split over a page.
 *
 * DIFFERENT FROM RAPTOR, and why:
 *  - Drawn straight with pdf-lib's Helvetica, the way Remus's quote PDF is (api/_lib/quotePdf.ts), not through
 *    Raptor's letter engine (LetterDocument, letterLayout, its own fonts): Remus has no letter builder, and the
 *    statement's head, logo and bank details then match the quote the client already holds.
 *  - The lockup is the company's own logo from Settings (as on the quote), not Raptor's firm lockup.
 *  - No interest, fees, VAT split, Annexure B or trust account: a builder's client has invoices and payments only.
 *    Raptor's progress bar ("% paid") is left out too; the ageing row (Current, 30, 60, 90+) takes its place,
 *    because that is what a builder chases.
 *  - The bank details are Settings' free text (Remus keeps them as one block), not Raptor's four fields.
 *
 * Reads everything through `db`, the caller's own Supabase client, so row-level security applies: someone who may
 * not see money gets no invoices, and the endpoint refuses them before that anyway.
 */

export class StatementPdfError extends Error {}

export type StatementClientKind = 'company' | 'contact'

interface Settings { name?: string; address?: string | null; phone?: string | null; email?: string | null; reg_no?: string | null; vat_no?: string | null; logo_url?: string | null; bank_details?: string | null }

export interface StatementClient {
  name: string
  /** The person at a company the statement is for (first contact with an email), or null. */
  attention: string | null
  address: string | null
  email: string | null
  phone: string | null
  vatNo: string | null
}

export interface StatementData {
  client: StatementClient
  settings: Settings
  statement: Statement
}

/** Today in Johannesburg, yyyy-mm-dd: the day changes at midnight there, not in UTC. */
export function todayInJohannesburg(now = new Date()): string {
  return new Date(now.getTime() + 2 * 3_600_000).toISOString().slice(0, 10)
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Everything one client's statement needs, read as the caller. */
export async function loadStatement(db: SupabaseClient, input: {
  kind: StatementClientKind; id: string; from: string | null; to: string | null; today?: string
}): Promise<StatementData> {
  const today = input.today ?? todayInJohannesburg()
  const from = input.from && YMD.test(input.from) ? input.from : null
  const to = input.to && YMD.test(input.to) ? input.to : today
  if (from && from > to) throw new StatementPdfError('The period ends before it starts.')
  const col = input.kind === 'company' ? 'company_id' : 'contact_id'

  const [clientRes, peopleRes, settingsRes, invRes, projRes] = await Promise.all([
    input.kind === 'company'
      ? db.from('companies').select('name, address, city, email, phone, vat_no').eq('id', input.id).maybeSingle()
      : db.from('contacts').select('first_name, last_name, address, email, mobile, phone, company_id').eq('id', input.id).maybeSingle(),
    input.kind === 'company'
      ? db.from('contacts').select('first_name, last_name, email').eq('company_id', input.id).order('first_name')
      : Promise.resolve({ data: [] as { first_name: string; last_name: string; email: string | null }[] }),
    db.from('company_settings').select('name, address, phone, email, reg_no, vat_no, logo_url, bank_details').eq('id', true).maybeSingle(),
    db.from('invoices').select('id, number, issue_date, due_date, description, amount_excl, vat, status').eq(col, input.id).order('issue_date'),
    db.from('projects').select('id').eq(col, input.id),
  ])
  const row = clientRes.data as Record<string, string | null> | null
  if (!row) throw new StatementPdfError('Client not found.')
  if (invRes.error) throw new StatementPdfError(`Could not read the invoices: ${invRes.error.message}`)
  const invoices = (invRes.data ?? []) as StatementInvoice[]
  const projectIds = new Set(((projRes.data ?? []) as { id: string }[]).map((p) => p.id))
  const invoiceIds = new Set(invoices.map((i) => i.id))

  // Payments against the client's invoices, and payments on the client's jobs that name no invoice.
  const [byInvoice, byProject] = await Promise.all([
    invoiceIds.size
      ? db.from('payments').select('id, invoice_id, project_id, date, amount, method, reference').in('invoice_id', [...invoiceIds])
      : Promise.resolve({ data: [], error: null }),
    projectIds.size
      ? db.from('payments').select('id, invoice_id, project_id, date, amount, method, reference').is('invoice_id', null).in('project_id', [...projectIds])
      : Promise.resolve({ data: [], error: null }),
  ])
  if (byInvoice.error || byProject.error) throw new StatementPdfError(`Could not read the payments: ${(byInvoice.error ?? byProject.error)!.message}`)
  const seen = new Set<string>()
  const payments = clientPayments(
    [...(byInvoice.data ?? []), ...(byProject.data ?? [])] as (StatementPayment & { project_id: string | null })[],
    invoiceIds, projectIds,
  ).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))

  const people = (peopleRes.data ?? []) as { first_name: string; last_name: string; email: string | null }[]
  const firstWithEmail = people.find((p) => p.email) ?? people[0]
  const client: StatementClient = input.kind === 'company'
    ? {
        name: row.name ?? '',
        attention: firstWithEmail ? `${firstWithEmail.first_name} ${firstWithEmail.last_name}`.trim() || null : null,
        address: [row.address, row.city].filter(Boolean).join('\n') || null,
        email: row.email ?? firstWithEmail?.email ?? null,
        phone: row.phone ?? null,
        vatNo: row.vat_no ?? null,
      }
    : {
        name: `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
        attention: null,
        address: row.address ?? null,
        email: row.email ?? null,
        phone: row.mobile || row.phone || null,
        vatNo: null,
      }

  return {
    client,
    settings: (settingsRes.data ?? {}) as Settings,
    statement: buildStatement({ invoices, payments, from, to, today }),
  }
}

/* ------------------------------------------------------------------ *
 * The drawing
 * ------------------------------------------------------------------ */

export function zar(n: number): string {
  const [int, frac] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}R ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac}`
}

export function longDate(ymd: string | null): string {
  if (!ymd) return ''
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${d} ${months[m - 1] ?? ''} ${y}`
}

/** "10 Sep 2026" -- Raptor's shortish(): short enough for a five-column table, long enough to be unambiguous. */
function shortDate(ymd: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m, d] = ymd.slice(0, 10).split('-')
  return `${Number(d)} ${months[Number(m) - 1] ?? m} ${y}`
}

/** The period in words for the head: "1 Aug 2026 to 7 Nov 2026", or "Up to 7 Nov 2026" for everything. */
export function periodWords(s: Pick<Statement, 'from' | 'to'>): string {
  return s.from ? `${shortDate(s.from)} to ${shortDate(s.to)}` : `Up to ${shortDate(s.to)}`
}

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 48
const FOOT = 34
/* The company's colours, written out as the quote PDF writes them (a PDF cannot read the app's skin). */
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const ACCENT = rgb(0.937, 0.404, 0.137) // Urban Haus orange #EF6723, as on the quote
const RULE = rgb(0.86, 0.88, 0.91)
const LIGHT = rgb(0.95, 0.96, 0.97)
const WHITE = rgb(1, 1, 1)

async function loadLogo(pdf: PDFDocument, settings: Settings): Promise<PDFImage | null> {
  // The company's uploaded logo, else the Urban Haus logo that ships with the app (public/brand/), as the quote does.
  const logoUrl = settings.logo_url || `${(process.env.APP_URL || 'https://remus-xi.vercel.app').replace(/\/$/, '')}/brand/urban-haus-logo.png`
  try {
    const r = await fetch(logoUrl)
    if (!r.ok) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    const type = r.headers.get('content-type') ?? ''
    if (type.includes('png') || logoUrl.toLowerCase().endsWith('.png')) return await pdf.embedPng(buf)
    if (type.includes('jpeg') || type.includes('jpg') || /\.jpe?g$/i.test(logoUrl)) return await pdf.embedJpg(buf)
  } catch {
    // an unreachable or unsupported logo falls back to the company name
  }
  return null
}

export async function buildStatementPdf(data: StatementData): Promise<{ bytes: Uint8Array; filename: string }> {
  const { client, settings, statement: st } = data
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Statement of account – ${client.name}`)
  pdf.setAuthor(settings.name ?? '')
  pdf.setCreator('Remus')
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  let page: PDFPage = pdf.addPage([A4.w, A4.h])
  let y = A4.h - MARGIN
  const right = A4.w - MARGIN
  const width = right - MARGIN

  // Helvetica here is WinAnsi-encoded: replace anything it can't draw rather than failing.
  const clean = (s: string, font: PDFFont) =>
    [...s.replace(/\t/g, ' ')].map((ch) => {
      try { font.encodeText(ch); return ch } catch { return '?' }
    }).join('')
  const textWidth = (s: string, size: number, font: PDFFont) => font.widthOfTextAtSize(clean(s, font), size)
  function wrap(s: string, size: number, font: PDFFont, maxWidth: number): string[] {
    const out: string[] = []
    for (const para of s.split(/\r?\n/)) {
      let line = ''
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word
        if (textWidth(next, size, font) <= maxWidth || !line) line = next
        else { out.push(line); line = word }
      }
      out.push(line)
    }
    return out
  }
  function draw(s: string, x: number, size: number, opts: { font?: PDFFont; color?: ReturnType<typeof rgb>; align?: 'left' | 'right'; at?: number } = {}) {
    const font = opts.font ?? regular
    const t = clean(s, font)
    const dx = opts.align === 'right' ? x - font.widthOfTextAtSize(t, size) : x
    page.drawText(t, { x: dx, y: opts.at ?? y, size, font, color: opts.color ?? INK })
  }
  const newPage = () => { page = pdf.addPage([A4.w, A4.h]); y = A4.h - MARGIN }
  const ensure = (space: number) => { if (y - space < MARGIN + FOOT) { newPage(); return true } return false }
  const label = (s: string, x: number, align: 'left' | 'right' = 'left') => draw(s, x, 7.5, { font: bold, color: ACCENT, align })

  /* ---------- THE HEAD: the lockup left; the title and the reference facts right, over a rule ---------- */
  const logo = await loadLogo(pdf, settings)
  const top = y
  if (logo) {
    const s = Math.min(60 / logo.height, 190 / logo.width)
    page.drawImage(logo, { x: MARGIN, y: y - logo.height * s, width: logo.width * s, height: logo.height * s })
    y -= logo.height * s + 8
  } else {
    y -= 18
    draw(settings.name ?? '', MARGIN, 18, { font: bold })
    y -= 12
  }
  for (const l of [
    ...(settings.address ? settings.address.split(/\r?\n/) : []),
    settings.phone ? `Tel: ${settings.phone}` : '',
    settings.email ?? '',
    settings.reg_no ? `Reg. no: ${settings.reg_no}` : '',
    settings.vat_no ? `VAT no: ${settings.vat_no}` : '',
  ].filter(Boolean)) {
    draw(l, MARGIN, 8, { color: MUTED })
    y -= 11
  }
  const leftBottom = y

  y = top - 16
  draw('STATEMENT OF ACCOUNT', right, 17, { font: bold, align: 'right' })
  y -= 9
  const blockW = 210
  page.drawRectangle({ x: right - blockW, y, width: blockW, height: 1.2, color: ACCENT })
  y -= 14
  const facts: [string, string][] = [
    ['Date', longDate(st.asAt)],
    ['Account', client.name],
    ['Period', periodWords(st)],
  ]
  for (const [k, v] of facts) {
    const vLines = wrap(v, 8.5, bold, blockW - 70)
    draw(k, right - blockW, 8.5, { color: MUTED })
    vLines.forEach((l, i) => draw(l, right, 8.5, { font: bold, align: 'right', at: y - i * 11 }))
    y -= 11 * vLines.length + 2
  }
  y = Math.min(y, leftBottom) - 8
  page.drawRectangle({ x: MARGIN, y, width, height: 3, color: ACCENT })
  y -= 22

  /* ---------- WHO, AND HOW THE BALANCE IS MADE UP, SIDE BY SIDE ---------- */
  const colX = MARGIN + width * 0.5 + 12
  const colW = right - colX
  const blockTop = y
  label('ACCOUNT HOLDER', MARGIN)
  label('HOW THE BALANCE IS MADE UP', colX)
  y -= 5
  page.drawRectangle({ x: MARGIN, y, width: width * 0.5 - 12, height: 0.6, color: RULE })
  page.drawRectangle({ x: colX, y, width: colW, height: 0.6, color: RULE })
  y -= 13
  let ly = y
  const who: [string, PDFFont, ReturnType<typeof rgb>][] = [
    [client.name, bold, INK],
    ...(client.attention ? ([[`Attention: ${client.attention}`, regular, INK]] as [string, PDFFont, ReturnType<typeof rgb>][]) : []),
    ...((client.address ?? '').split(/\r?\n/).filter(Boolean).map((l) => [l, regular, MUTED] as [string, PDFFont, ReturnType<typeof rgb>])),
    ...(client.email ? ([[client.email, regular, MUTED]] as [string, PDFFont, ReturnType<typeof rgb>][]) : []),
    ...(client.vatNo ? ([[`VAT no: ${client.vatNo}`, regular, MUTED]] as [string, PDFFont, ReturnType<typeof rgb>][]) : []),
  ]
  for (const [l, f, c] of who) {
    for (const w of wrap(l, 9, f, width * 0.5 - 16)) { draw(w, MARGIN, 9, { font: f, color: c, at: ly }); ly -= 12 }
  }
  let ry = y
  const madeUp: [string, string][] = [
    [st.from ? 'Balance brought forward' : 'Opening balance', zar(st.opening)],
    ['Invoiced in this period', zar(st.invoiced)],
    ['Payments received', st.received ? `- ${zar(st.received)}` : zar(0)],
  ]
  for (const [k, v] of madeUp) {
    draw(k, colX, 9, { at: ry })
    draw(v, right, 9, { align: 'right', at: ry })
    ry -= 6
    page.drawRectangle({ x: colX, y: ry, width: colW, height: 0.4, color: RULE })
    ry -= 12
  }
  page.drawRectangle({ x: colX, y: ry - 6, width: colW, height: 18, color: LIGHT })
  const owingWord = st.closing < 0 ? 'IN CREDIT' : 'BALANCE NOW OWING'
  draw(owingWord, colX + 4, 9, { font: bold, at: ry })
  draw(zar(Math.abs(st.closing)), right - 4, 9, { font: bold, align: 'right', at: ry })
  ry -= 18
  y = Math.min(ly, ry, blockTop - 40) - 14

  /* ---------- EVERY MOVEMENT (the five columns, in the firm's words) ---------- */
  const cols = { date: MARGIN, detail: MARGIN + 66, debit: right - 160, credit: right - 80, balance: right }
  const detailW = cols.debit - 70 - cols.detail
  function heading() {
    draw('Every movement on the account', MARGIN, 11, { font: bold })
    y -= 16
  }
  function tableHeader() {
    label('DATE', cols.date)
    label('DETAIL', cols.detail)
    label('DEBIT', cols.debit, 'right')
    label('CREDIT', cols.credit, 'right')
    label('BALANCE', cols.balance, 'right')
    y -= 5
    page.drawRectangle({ x: MARGIN, y, width, height: 1, color: INK })
    y -= 13
  }
  ensure(70)
  heading()
  tableHeader()
  /* A DASH, NOT R 0.00, in the column a line is not in: a nought reads as a charge of nothing. */
  const rows: { date: string; detail: string; debit: string; credit: string; balance: string; strong?: boolean }[] = [
    ...(st.from ? [{ date: shortDate(st.from), detail: 'Balance brought forward', debit: '—', credit: '—', balance: zar(st.opening), strong: true }] : []),
    ...st.lines.map((l) => ({
      date: shortDate(l.date), detail: l.detail,
      debit: l.debit > 0 ? zar(l.debit) : '—', credit: l.credit > 0 ? zar(l.credit) : '—', balance: zar(l.balance),
    })),
  ]
  if (rows.length === 0) {
    draw('Nothing was invoiced or received on this account in this period.', MARGIN, 9, { color: MUTED })
    y -= 16
  }
  for (const r of rows) {
    const lines = wrap(r.detail, 8.5, regular, detailW)
    const h = lines.length * 11
    if (ensure(h + 8)) tableHeader()
    const rowTop = y
    draw(r.date, cols.date, 8.5)
    lines.forEach((l, i) => draw(l, cols.detail, 8.5, { font: r.strong ? bold : regular, at: rowTop - i * 11 }))
    draw(r.debit.replace('—', '-'), cols.debit, 8.5, { align: 'right', color: r.debit === '—' ? MUTED : INK })
    draw(r.credit.replace('—', '-'), cols.credit, 8.5, { align: 'right', color: r.credit === '—' ? MUTED : INK })
    draw(r.balance, cols.balance, 8.5, { align: 'right', font: r.strong ? bold : regular })
    y = rowTop - (lines.length - 1) * 11 - 6
    page.drawRectangle({ x: MARGIN, y, width, height: 0.4, color: RULE })
    y -= 12
  }

  /* ---------- HOW LATE IT IS: Finance's ageing, as at the statement's date ---------- */
  ensure(60)
  y -= 8
  label(`WHAT IS OWED, BY AGE (AS AT ${shortDate(st.asAt).toUpperCase()})`, MARGIN)
  y -= 5
  page.drawRectangle({ x: MARGIN, y, width, height: 0.6, color: RULE })
  y -= 14
  const cells: [string, number][] = [...st.ageing.map((a) => [a.bucket, a.amount] as [string, number]), ['Amount due', st.due]]
  const cw = width / cells.length
  cells.forEach(([k, v], i) => {
    const x = MARGIN + i * cw
    const last = i === cells.length - 1
    if (last) page.drawRectangle({ x: x + 2, y: y - 18, width: cw - 2, height: 32, color: LIGHT })
    draw(k, x + cw - 6, 7.5, { color: MUTED, align: 'right' })
    draw(zar(v), x + cw - 6, 9.5, { font: last || (i > 0 && v > 0) ? bold : regular, align: 'right', at: y - 13 })
  })
  y -= 34

  /* ---------- THE BALANCE IN THE DARK BAND, where the reader's eye ends up (Raptor's look B) ---------- */
  ensure(40)
  const bandH = 24
  page.drawRectangle({ x: MARGIN, y: y - bandH + 8, width, height: bandH, color: INK })
  const bandWord = st.inCredit > 0 && st.due === 0 ? 'IN CREDIT' : 'AMOUNT DUE'
  draw(bandWord, right - 130, 10, { font: bold, color: WHITE, align: 'right', at: y - 7 })
  draw(zar(st.inCredit > 0 && st.due === 0 ? st.inCredit : st.due), right - 8, 10.5, { font: bold, color: WHITE, align: 'right', at: y - 7 })
  y -= bandH + 14

  /* ---------- HOW TO PAY: the bank details, our reference, proof of payment, who to ask -- in one box never
     split over a page; the words above it keep with it ---------- */
  const bank = (settings.bank_details ?? '').trim()
  const halfW = width / 2 - 10
  const bankLines = bank ? wrap(bank, 8.5, regular, halfW) : ['Ask us for our banking details.']
  const refLines: [string, string][] = [
    ['REFERENCE', client.name],
    ['PROOF OF PAYMENT', settings.email ? `Email it to ${settings.email} on the day you pay` : 'Send it to us on the day you pay'],
    ...(settings.phone ? ([['QUESTIONS', `Call us on ${settings.phone}`]] as [string, string][]) : []),
  ]
  const refH = refLines.reduce((s, [, v]) => s + 10 + wrap(v, 8.5, regular, halfW).length * 11 + 4, 0)
  const boxH = Math.max(bankLines.length * 11 + 10, refH) + 26
  ensure(boxH + 30)
  label('HOW TO PAY', MARGIN)
  y -= 5
  page.drawRectangle({ x: MARGIN, y, width, height: 0.6, color: RULE })
  y -= 14
  const boxTop = y
  draw('BANKING DETAILS', MARGIN, 7.5, { font: bold, color: MUTED })
  let by = y - 12
  for (const l of bankLines) { draw(l, MARGIN, 8.5, { at: by }); by -= 11 }
  let ry2 = boxTop
  const rx = MARGIN + width / 2 + 10
  for (const [k, v] of refLines) {
    draw(k, rx, 7.5, { font: bold, color: MUTED, at: ry2 })
    ry2 -= 12
    for (const l of wrap(v, 8.5, k === 'REFERENCE' ? bold : regular, halfW)) { draw(l, rx, 8.5, { font: k === 'REFERENCE' ? bold : regular, at: ry2 }); ry2 -= 11 }
    ry2 -= 4
  }
  y = Math.min(by, ry2) - 8
  for (const l of wrap('If anything here does not agree with your own record, tell us in writing and we will check it.', 8, regular, width)) {
    draw(l, MARGIN, 8, { color: MUTED })
    y -= 10
  }

  /* ---------- THE RUNNING FOOT on every page ---------- */
  const pages = pdf.getPages()
  const foot = ['Statement of account', client.name, settings.name, settings.phone, settings.email].filter(Boolean).join(' · ')
  pages.forEach((p, i) => {
    const pageNo = `Page ${i + 1} of ${pages.length}`
    const room = width - regular.widthOfTextAtSize(pageNo, 7) - 16
    let text = clean(foot, regular)
    if (regular.widthOfTextAtSize(text, 7) > room) {
      while (text.length > 4 && regular.widthOfTextAtSize(`${text}…`, 7) > room) text = text.slice(0, -1)
      text = `${text}…`
    }
    p.drawRectangle({ x: MARGIN, y: MARGIN / 2 + 10, width, height: 0.4, color: RULE })
    p.drawText(text, { x: MARGIN, y: MARGIN / 2, size: 7, font: regular, color: MUTED })
    p.drawText(pageNo, { x: right - regular.widthOfTextAtSize(pageNo, 7), y: MARGIN / 2, size: 7, font: regular, color: MUTED })
  })

  return { bytes: await pdf.save(), filename: statementFileName(client.name, st.asAt) }
}

/** The figures for an email body: what is owed and how late, in a few lines. */
export function statementSummary(st: Statement): { owing: number; overdue: number } {
  const overdue = round2(st.ageing.filter((a) => a.bucket !== 'Current').reduce((s, a) => s + a.amount, 0))
  return { owing: st.due, overdue }
}
