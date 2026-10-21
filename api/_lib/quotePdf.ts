import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Builds an A4 PDF of a quote, laid out like the in-app print view (src/pages/build/quotes/QuotePrint.tsx):
 * letterhead, client and project, line items by section, totals, visuals, notes, terms, banking
 * details and an acceptance block. Uses pdf-lib's built-in Helvetica, so nothing is read from disk.
 *
 * Reads everything through `db`, the caller's own Supabase client, so RLS applies.
 */

interface QuoteRow {
  id: string
  number: string | null
  title: string
  site_address: string | null
  issue_date: string
  valid_until: string | null
  notes: string | null
  terms: string | null
  discount: number
  vat_rate: number
  company_id: string | null
  contact_id: string | null
}
interface ItemRow { section: string | null; description: string; quantity: number; unit: string; unit_price: number }
interface Settings { name?: string; address?: string | null; phone?: string | null; email?: string | null; reg_no?: string | null; vat_no?: string | null; logo_url?: string | null; bank_details?: string | null }

export class QuotePdfError extends Error {}

/** Same rounding as round2 in src/lib/format.ts: cents, half away from zero, like Postgres round(x, 2). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return n
  const cents = Math.round(Number((Math.abs(n) * 100).toPrecision(15)))
  return (Math.sign(n) * cents) / 100 || 0
}

export function zar(n: number): string {
  const [int, frac] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}R ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac}`
}

function formatDate(ymd: string | null): string {
  if (!ymd) return ''
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1] ?? ''} ${y}`
}

export interface QuotePdf {
  bytes: Uint8Array
  filename: string
  totals: { subtotal: number; totalExcl: number; vat: number; totalIncl: number }
}

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 48
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const ACCENT = rgb(0.937, 0.404, 0.137) // Urban Haus orange #EF6723
const RULE = rgb(0.89, 0.91, 0.94)

export async function buildQuotePdf(db: SupabaseClient, quoteId: string): Promise<QuotePdf> {
  const [quoteRes, itemsRes, settingsRes, attRes] = await Promise.all([
    db.from('quotes').select('*').eq('id', quoteId).maybeSingle(),
    db.from('quote_items').select('section, description, quantity, unit, unit_price').eq('quote_id', quoteId).order('sort_order'),
    db.from('company_settings').select('*').eq('id', true).maybeSingle(),
    db.from('quote_attachments').select('file_path, file_name, mime_type, caption, show_on_quote').eq('quote_id', quoteId).order('sort_order'),
  ])
  const quote = quoteRes.data as QuoteRow | null
  if (!quote) throw new QuotePdfError('Quote not found.')
  // Leave out the blank placeholder line an empty section keeps (see QuoteEditor).
  const items = ((itemsRes.data ?? []) as ItemRow[]).filter((i) => i.description.trim() || Number(i.unit_price))
  const settings = (settingsRes.data ?? {}) as Settings
  const gallery = ((attRes.data ?? []) as { file_path: string; mime_type: string | null; caption: string | null; show_on_quote: boolean }[])
    .filter((a) => a.show_on_quote && (a.mime_type === 'image/jpeg' || a.mime_type === 'image/png'))
    .slice(0, 8)

  const [company, contact] = await Promise.all([
    quote.company_id ? db.from('companies').select('name, address, email, vat_no').eq('id', quote.company_id).maybeSingle().then((r) => r.data) : null,
    quote.contact_id ? db.from('contacts').select('first_name, last_name, address, email').eq('id', quote.contact_id).maybeSingle().then((r) => r.data) : null,
  ])

  // Same arithmetic as the quote_totals view: VAT and total from the unrounded amount excl. VAT.
  const rawSubtotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0)
  const rawExcl = rawSubtotal - Number(quote.discount || 0)
  const rate = Number(quote.vat_rate || 0)
  const subtotal = round2(rawSubtotal)
  const totalExcl = round2(rawExcl)
  const vat = round2((rawExcl * rate) / 100)
  const totalIncl = round2(rawExcl * (1 + rate / 100))

  const pdf = await PDFDocument.create()
  pdf.setTitle(`Quote ${quote.number ?? ''} – ${quote.title}`)
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
      try {
        font.encodeText(ch)
        return ch
      } catch {
        return '?'
      }
    }).join('')
  const textWidth = (s: string, size: number, font: PDFFont) => font.widthOfTextAtSize(clean(s, font), size)

  function wrap(s: string, size: number, font: PDFFont, maxWidth: number): string[] {
    const out: string[] = []
    for (const para of s.split(/\r?\n/)) {
      let line = ''
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word
        if (textWidth(next, size, font) <= maxWidth || !line) line = next
        else {
          out.push(line)
          line = word
        }
      }
      out.push(line)
    }
    return out
  }

  function ensure(space: number) {
    if (y - space < MARGIN) {
      page = pdf.addPage([A4.w, A4.h])
      y = A4.h - MARGIN
    }
  }

  function draw(s: string, x: number, size: number, opts: { font?: PDFFont; color?: ReturnType<typeof rgb>; align?: 'left' | 'right' } = {}) {
    const font = opts.font ?? regular
    const t = clean(s, font)
    const dx = opts.align === 'right' ? x - font.widthOfTextAtSize(t, size) : x
    page.drawText(t, { x: dx, y, size, font, color: opts.color ?? INK })
  }

  function block(label: string, body: string, size = 9) {
    const lines = wrap(body, size, regular, width)
    ensure(28)
    y -= 14
    draw(label.toUpperCase(), MARGIN, 7.5, { font: bold, color: MUTED })
    y -= 13
    for (const l of lines) {
      ensure(size + 4)
      draw(l, MARGIN, size, { color: rgb(0.2, 0.25, 0.33) })
      y -= size + 3.5
    }
  }

  // ---------- Letterhead ----------
  let logo: PDFImage | null = null
  // The company's uploaded logo, else the Urban Haus logo that ships with the app (public/brand/).
  const logoUrl = settings.logo_url || `${(process.env.APP_URL || 'https://remus-xi.vercel.app').replace(/\/$/, '')}/brand/urban-haus-logo.png`
  try {
    const r = await fetch(logoUrl)
    const buf = new Uint8Array(await r.arrayBuffer())
    const type = r.headers.get('content-type') ?? ''
    if (!r.ok) throw new Error(`logo HTTP ${r.status}`)
    if (type.includes('png') || logoUrl.toLowerCase().endsWith('.png')) logo = await pdf.embedPng(buf)
    else if (type.includes('jpeg') || type.includes('jpg') || /\.jpe?g$/i.test(logoUrl)) logo = await pdf.embedJpg(buf)
  } catch {
    logo = null // an unreachable or unsupported logo falls back to the company name
  }
  const top = y
  if (logo) {
    const s = Math.min(64 / logo.height, 200 / logo.width)
    page.drawImage(logo, { x: MARGIN, y: y - logo.height * s, width: logo.width * s, height: logo.height * s })
    y -= logo.height * s + 8
  } else {
    y -= 18
    draw(settings.name ?? '', MARGIN, 18, { font: bold })
    y -= 12
  }
  const companyLines = [
    ...(settings.address ? settings.address.split(/\r?\n/) : []),
    settings.phone ? `Tel: ${settings.phone}` : '',
    settings.email ?? '',
    settings.reg_no ? `Reg. no: ${settings.reg_no}` : '',
    settings.vat_no ? `VAT no: ${settings.vat_no}` : '',
  ].filter(Boolean)
  for (const l of companyLines) {
    draw(l, MARGIN, 8, { color: MUTED })
    y -= 11
  }
  const leftBottom = y

  y = top - 22
  draw('QUOTATION', right, 22, { align: 'right' })
  y -= 18
  const meta: [string, string][] = [
    ['Quote no.', quote.number ?? ''],
    ['Date', formatDate(quote.issue_date)],
    ...(quote.valid_until ? ([['Valid until', formatDate(quote.valid_until)]] as [string, string][]) : []),
  ]
  for (const [k, v] of meta) {
    draw(v, right, 8.5, { font: k === 'Quote no.' ? bold : regular, align: 'right' })
    draw(k, right - 90, 8.5, { color: MUTED, align: 'right' })
    y -= 12
  }

  y = Math.min(y, leftBottom) - 6
  page.drawRectangle({ x: MARGIN, y, width, height: 3, color: ACCENT })
  y -= 22

  // ---------- Prepared for / Project ----------
  const colX = MARGIN + width / 2 + 10
  const blockTop = y
  draw('PREPARED FOR', MARGIN, 7.5, { font: bold, color: MUTED })
  draw('PROJECT', colX, 7.5, { font: bold, color: MUTED })
  y -= 14
  const contactName = contact ? `${contact.first_name} ${contact.last_name}`.trim() : ''
  const clientLines: [string, PDFFont][] = [
    ...(company ? ([[company.name, bold]] as [string, PDFFont][]) : []),
    ...(contactName ? ([[contactName, company ? regular : bold]] as [string, PDFFont][]) : []),
    ...((company?.address ?? contact?.address ?? '').split(/\r?\n/).filter(Boolean).map((l: string) => [l, regular] as [string, PDFFont])),
    ...((contact?.email ?? company?.email) ? ([[contact?.email ?? company?.email, regular]] as [string, PDFFont][]) : []),
    ...(company?.vat_no ? ([[`VAT no: ${company.vat_no}`, regular]] as [string, PDFFont][]) : []),
  ]
  let ly = y
  for (const [l, f] of clientLines) {
    for (const w of wrap(l, 9, f, width / 2 - 10)) {
      page.drawText(clean(w, f), { x: MARGIN, y: ly, size: 9, font: f, color: INK })
      ly -= 12
    }
  }
  let ry = y
  for (const w of wrap(quote.title, 9, bold, width / 2 - 10)) {
    page.drawText(clean(w, bold), { x: colX, y: ry, size: 9, font: bold, color: INK })
    ry -= 12
  }
  for (const w of wrap(quote.site_address ?? '', 9, regular, width / 2 - 10).filter(Boolean)) {
    page.drawText(clean(w, regular), { x: colX, y: ry, size: 9, font: regular, color: MUTED })
    ry -= 12
  }
  y = Math.min(ly, ry, blockTop - 30) - 12

  // ---------- Line items ----------
  const cols = { qty: right - 205, unit: right - 195, rate: right - 85, amount: right }
  const descWidth = cols.qty - MARGIN - 40
  function tableHeader() {
    draw('DESCRIPTION', MARGIN, 7.5, { font: bold, color: MUTED })
    draw('QTY', cols.qty, 7.5, { font: bold, color: MUTED, align: 'right' })
    draw('UNIT', cols.unit, 7.5, { font: bold, color: MUTED })
    draw('RATE', cols.rate, 7.5, { font: bold, color: MUTED, align: 'right' })
    draw('AMOUNT', cols.amount, 7.5, { font: bold, color: MUTED, align: 'right' })
    y -= 5
    page.drawRectangle({ x: MARGIN, y, width, height: 1.2, color: INK })
    y -= 13
  }
  ensure(40)
  tableHeader()

  const groups: { section: string | null; items: ItemRow[] }[] = []
  for (const it of items) {
    const s = it.section || null
    let g = groups.find((x) => x.section === s)
    if (!g) groups.push((g = { section: s, items: [] }))
    g.items.push(it)
  }
  const showSections = groups.length > 1 || Boolean(groups[0]?.section)
  for (const g of groups) {
    if (showSections) {
      ensure(30)
      y -= 4
      draw((g.section ?? 'General').toUpperCase(), MARGIN, 8, { font: bold })
      y -= 13
    }
    for (const it of g.items) {
      const lines = wrap(it.description || ' ', 9, regular, descWidth)
      if (y - lines.length * 11.5 - 6 < MARGIN) {
        page = pdf.addPage([A4.w, A4.h])
        y = A4.h - MARGIN
        tableHeader()
      }
      const rowTop = y
      lines.forEach((l, i) => {
        page.drawText(clean(l, regular), { x: MARGIN, y: rowTop - i * 11.5, size: 9, font: regular, color: INK })
      })
      draw(String(Number(it.quantity)), cols.qty, 9, { align: 'right' })
      draw(it.unit, cols.unit, 9)
      draw(zar(Number(it.unit_price)), cols.rate, 9, { align: 'right' })
      draw(zar(round2(Number(it.quantity) * Number(it.unit_price))), cols.amount, 9, { align: 'right' })
      y = rowTop - (lines.length - 1) * 11.5 - 6
      page.drawRectangle({ x: MARGIN, y, width, height: 0.5, color: RULE })
      y -= 12
    }
  }

  // ---------- Totals ----------
  const totals: [string, string, boolean][] = [
    ['Subtotal', zar(subtotal), false],
    ...(Number(quote.discount) > 0 ? ([['Discount', `-${zar(Number(quote.discount))}`, false]] as [string, string, boolean][]) : []),
    ['Total excl. VAT', zar(totalExcl), false],
    [`VAT (${Number(quote.vat_rate)}%)`, zar(vat), false],
  ]
  ensure(totals.length * 14 + 30)
  y -= 6
  const labelX = right - 200
  for (const [k, v] of totals) {
    draw(k, labelX, 9, { color: MUTED })
    draw(v, right, 9, { align: 'right' })
    y -= 14
  }
  page.drawRectangle({ x: labelX, y: y + 9, width: right - labelX, height: 1.2, color: INK })
  y -= 4
  draw('Total', labelX, 11, { font: bold })
  draw(zar(totalIncl), right, 11, { font: bold, align: 'right' })
  y -= 10

  // ---------- Visuals ----------
  if (gallery.length > 0) {
    const images: { img: PDFImage; caption: string | null }[] = []
    for (const a of gallery) {
      const dl = await db.storage.from('quote-files').download(a.file_path)
      if (dl.error || !dl.data) continue
      try {
        const buf = new Uint8Array(await dl.data.arrayBuffer())
        images.push({ img: a.mime_type === 'image/png' ? await pdf.embedPng(buf) : await pdf.embedJpg(buf), caption: a.caption })
      } catch {
        // skip images pdf-lib can't read (e.g. progressive or CMYK JPEGs it rejects)
      }
    }
    if (images.length > 0) {
      ensure(40)
      y -= 14
      draw('VISUALS', MARGIN, 7.5, { font: bold, color: MUTED })
      y -= 10
      const cellW = (width - 16) / 2
      const cellH = cellW * 0.75
      for (let i = 0; i < images.length; i += 2) {
        ensure(cellH + 24)
        for (let j = 0; j < 2 && i + j < images.length; j++) {
          const { img, caption } = images[i + j]
          const s = Math.min(cellW / img.width, cellH / img.height)
          const x = MARGIN + j * (cellW + 16)
          page.drawImage(img, { x: x + (cellW - img.width * s) / 2, y: y - cellH + (cellH - img.height * s) / 2, width: img.width * s, height: img.height * s })
          if (caption) page.drawText(clean(wrap(caption, 8, regular, cellW)[0], regular), { x, y: y - cellH - 11, size: 8, font: regular, color: MUTED })
        }
        y -= cellH + 22
      }
    }
  }

  if (quote.notes) block('Notes', quote.notes, 9)
  if (quote.terms) block('Terms & conditions', quote.terms, 8)
  if (settings.bank_details) block('Banking details', settings.bank_details, 8)

  ensure(50)
  y -= 40
  const half = (width - 30) / 2
  page.drawRectangle({ x: MARGIN, y, width: half, height: 0.6, color: MUTED })
  page.drawRectangle({ x: MARGIN + half + 30, y, width: half, height: 0.6, color: MUTED })
  y -= 11
  draw('Accepted by (name & signature)', MARGIN, 8, { color: MUTED })
  draw('Date', MARGIN + half + 30, 8, { color: MUTED })

  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    if (pages.length > 1) {
      const label = `Page ${i + 1} of ${pages.length}`
      p.drawText(label, { x: right - regular.widthOfTextAtSize(label, 7.5), y: MARGIN / 2, size: 7.5, font: regular, color: MUTED })
    }
  })

  const safe = (quote.number || quote.title || 'quote').replace(/[^A-Za-z0-9._-]+/g, '_')
  return { bytes: await pdf.save(), filename: `Quote-${safe}.pdf`, totals: { subtotal, totalExcl, vat, totalIncl } }
}
