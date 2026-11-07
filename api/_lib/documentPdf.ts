import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'

/**
 * A LIBRARY DOCUMENT AS A PDF, ON THE LETTERHEAD (Remus · Handover 8).
 *
 * The letterhead is the company's own details from Settings, drawn as the quote PDF draws them
 * (api/_lib/quotePdf.ts): the logo, the name, address, phone, email, registration and VAT numbers. Raptor's
 * letterhead is an uploaded A4 picture with margins; Remus has none, so it draws what Settings holds.
 *
 * The words use the Library's small markup (src/lib/documentTemplates.ts reads the same):
 *   "# "  a heading       "## " a smaller heading       "- " a bullet       **bold** inside a line
 *   a blank line          a gap between paragraphs      every other line    printed as its own line
 *
 * SIGNED: the signature block carries the drawn signature, the typed name, the date and time, the internet
 * address, and the document's fingerprint (SHA-256 of its words), as Raptor's signed copy does. Not signed but
 * signable: blank lines to sign on paper.
 */

export interface Letterhead {
  name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  reg_no?: string | null
  vat_no?: string | null
  logo_url?: string | null
}

export interface SignedMark {
  name: string
  at: string
  ip: string | null
  pngDataUrl: string
  hash: string
  reference: string
}

const A4 = { w: 595.28, h: 841.89 }
const MARGIN = 54
const INK = rgb(0.06, 0.09, 0.16)
const MUTED = rgb(0.39, 0.45, 0.55)
const ACCENT = rgb(0.937, 0.404, 0.137) // the quote PDF's accent, so a contract and its quote look like one set
const RULE = rgb(0.89, 0.91, 0.94)

/** The date and time in Johannesburg, written out: "7 Nov 2026, 14:05". */
export function jhbDateTime(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} (SAST)`
}

interface Kit {
  pdf: PDFDocument
  regular: PDFFont
  bold: PDFFont
  page: PDFPage
  y: number
}

function cleanFor(font: PDFFont, s: string): string {
  return [...s.replace(/\t/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/–|—/g, '-')]
    .map((ch) => {
      try {
        font.encodeText(ch)
        return ch
      } catch {
        return '?'
      }
    }).join('')
}

/** A line's words with their weight: **bold** runs are bold. */
function runs(line: string, startBold = false): { word: string; bold: boolean }[] {
  const out: { word: string; bold: boolean }[] = []
  let bold = startBold
  line.split('**').forEach((part, i) => {
    if (i > 0) bold = !bold
    for (const w of part.split(/\s+/)) if (w) out.push({ word: w, bold })
  })
  return out
}

async function loadLogo(pdf: PDFDocument, url: string | null | undefined): Promise<PDFImage | null> {
  const logoUrl = url || `${(process.env.APP_URL || 'https://remus-xi.vercel.app').replace(/\/$/, '')}/brand/urban-haus-logo.png`
  try {
    const r = await fetch(logoUrl)
    if (!r.ok) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    const type = r.headers.get('content-type') ?? ''
    if (type.includes('png') || logoUrl.toLowerCase().endsWith('.png')) return await pdf.embedPng(buf)
    if (type.includes('jpeg') || type.includes('jpg') || /\.jpe?g$/i.test(logoUrl)) return await pdf.embedJpg(buf)
  } catch {
    /* an unreachable or unsupported logo falls back to the company's name */
  }
  return null
}

function newPage(k: Kit) {
  k.page = k.pdf.addPage([A4.w, A4.h])
  k.y = A4.h - MARGIN
}

function ensure(k: Kit, space: number) {
  if (k.y - space < MARGIN + 18) newPage(k)
}

function drawText(k: Kit, s: string, x: number, size: number, font: PDFFont, color = INK, align: 'left' | 'right' = 'left') {
  const t = cleanFor(font, s)
  const dx = align === 'right' ? x - font.widthOfTextAtSize(t, size) : x
  k.page.drawText(t, { x: dx, y: k.y, size, font, color })
}

/** One line of words, wrapped to the width, bold where marked. */
function paragraph(k: Kit, line: string, size: number, opts: { indent?: number; bold?: boolean; color?: ReturnType<typeof rgb>; lead?: number } = {}) {
  const left = MARGIN + (opts.indent ?? 0)
  const width = A4.w - MARGIN - left
  const words = runs(line, opts.bold)
  const lead = opts.lead ?? size * 1.42
  const space = k.regular.widthOfTextAtSize(' ', size)
  let row: typeof words = []
  let rowW = 0
  const flush = () => {
    ensure(k, lead)
    /* ONE drawText PER RUN OF THE SAME WEIGHT, not per word: pdf-lib measures with Helvetica's kerning ("VA",
       "AT") but draws without it, so words placed one by one crept into the space after them ("VATnumber"). */
    let x = left
    const segments: { text: string; bold: boolean }[] = []
    for (const w of row) {
      const last = segments[segments.length - 1]
      if (last && last.bold === w.bold) last.text += ` ${w.word}`
      else segments.push({ text: w.word, bold: w.bold })
    }
    for (const seg of segments) {
      const font = seg.bold ? k.bold : k.regular
      const t = cleanFor(font, seg.text)
      k.page.drawText(t, { x, y: k.y, size, font, color: opts.color ?? INK })
      x += font.widthOfTextAtSize(t, size) + space + 0.6
    }
    k.y -= lead
    row = []
    rowW = 0
  }
  for (const w of words) {
    const ww = (w.bold ? k.bold : k.regular).widthOfTextAtSize(cleanFor(w.bold ? k.bold : k.regular, w.word), size)
    if (row.length && rowW + space + ww > width) flush()
    rowW += (row.length ? space : 0) + ww
    row.push(w)
  }
  if (row.length) flush()
  else k.y -= lead
}

/** The letterhead at the top of the first page. */
async function letterhead(k: Kit, s: Letterhead) {
  const logo = await loadLogo(k.pdf, s.logo_url)
  const top = k.y
  let leftBottom = k.y
  if (logo) {
    const sc = Math.min(58 / logo.height, 190 / logo.width)
    k.page.drawImage(logo, { x: MARGIN, y: k.y - logo.height * sc, width: logo.width * sc, height: logo.height * sc })
    leftBottom = k.y - logo.height * sc
  } else {
    k.y -= 18
    drawText(k, s.name ?? '', MARGIN, 18, k.bold)
    leftBottom = k.y - 6
  }
  const right = A4.w - MARGIN
  const lines = [
    s.name ?? '',
    ...(s.address ? s.address.split(/\r?\n/) : []),
    s.phone ? `Tel: ${s.phone}` : '',
    s.email ?? '',
    s.reg_no ? `Reg. no: ${s.reg_no}` : '',
    s.vat_no ? `VAT no: ${s.vat_no}` : '',
  ].filter(Boolean)
  k.y = top - 8
  lines.forEach((l, i) => {
    drawText(k, l, right, i === 0 ? 9 : 8, i === 0 ? k.bold : k.regular, i === 0 ? INK : MUTED, 'right')
    k.y -= 11
  })
  k.y = Math.min(k.y, leftBottom) - 8
  k.page.drawRectangle({ x: MARGIN, y: k.y, width: A4.w - 2 * MARGIN, height: 2.5, color: ACCENT })
  k.y -= 26
}

/** The Library's markup, drawn. */
function body(k: Kit, text: string) {
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) { k.y -= 6; continue }
    if (line.startsWith('# ')) {
      ensure(k, 40)
      k.y -= 4
      paragraph(k, line.slice(2).replace(/\*\*/g, ''), 15, { bold: true, lead: 22 })
      continue
    }
    if (line.startsWith('## ')) {
      ensure(k, 34)
      k.y -= 6
      paragraph(k, line.slice(3).replace(/\*\*/g, ''), 11, { bold: true, lead: 16 })
      continue
    }
    if (/^[-*] /.test(line)) {
      ensure(k, 14)
      drawText(k, '•', MARGIN + 4, 10, k.regular)
      paragraph(k, line.slice(2), 10, { indent: 16 })
      continue
    }
    paragraph(k, line, 10)
  }
}

/** Blank lines to sign on paper, for the client and for the company. */
function paperSignatures(k: Kit, company: string, client: string) {
  ensure(k, 110)
  k.y -= 30
  const half = (A4.w - 2 * MARGIN - 30) / 2
  const cols = [{ x: MARGIN, who: client ? `For the client: ${client}` : 'For the client' }, { x: MARGIN + half + 30, who: `For ${company}` }]
  for (const c of cols) k.page.drawRectangle({ x: c.x, y: k.y, width: half, height: 0.6, color: MUTED })
  k.y -= 11
  for (const c of cols) drawText(k, `Signature · ${c.who}`, c.x, 7.5, k.regular, MUTED)
  k.y -= 34
  for (const c of cols) k.page.drawRectangle({ x: c.x, y: k.y, width: half, height: 0.6, color: MUTED })
  k.y -= 11
  for (const c of cols) drawText(k, 'Name and date', c.x, 7.5, k.regular, MUTED)
  k.y -= 10
}

/** The electronic signature block: the mark, the name, when, from where, and the fingerprint. */
async function signedBlock(k: Kit, mark: SignedMark) {
  ensure(k, 190)
  k.y -= 18
  const width = A4.w - 2 * MARGIN
  const boxTop = k.y
  const boxH = 168
  k.page.drawRectangle({ x: MARGIN, y: boxTop - boxH, width, height: boxH, borderColor: RULE, borderWidth: 1, color: rgb(0.985, 0.985, 0.98) })
  k.y = boxTop - 18
  drawText(k, 'SIGNED ELECTRONICALLY', MARGIN + 14, 8, k.bold, MUTED)
  k.y -= 8
  try {
    const png = await k.pdf.embedPng(Buffer.from(mark.pngDataUrl.split(',')[1] ?? '', 'base64'))
    const sc = Math.min(64 / png.height, 220 / png.width)
    k.page.drawImage(png, { x: MARGIN + 14, y: k.y - png.height * sc, width: png.width * sc, height: png.height * sc })
  } catch {
    /* an unreadable drawing still leaves the name, time and fingerprint, which are the record */
  }
  k.y -= 70
  k.page.drawRectangle({ x: MARGIN + 14, y: k.y, width: 240, height: 0.6, color: MUTED })
  k.y -= 13
  const facts: [string, string][] = [
    ['Signed by', mark.name],
    ['When', jhbDateTime(mark.at)],
    ['From', mark.ip || 'not recorded'],
    ['Reference', mark.reference],
  ]
  for (const [label, value] of facts) {
    drawText(k, label, MARGIN + 14, 8, k.regular, MUTED)
    drawText(k, value, MARGIN + 80, 8.5, label === 'Signed by' ? k.bold : k.regular)
    k.y -= 11.5
  }
  drawText(k, 'Fingerprint of the signed words (SHA-256):', MARGIN + 14, 7, k.regular, MUTED)
  k.y -= 9.5
  drawText(k, mark.hash, MARGIN + 14, 6.6, k.regular, MUTED)
  k.y = boxTop - boxH - 10
}

function footers(pdf: PDFDocument, regular: PDFFont, s: Letterhead) {
  const pages = pdf.getPages()
  const left = [s.name, s.reg_no ? `Reg. ${s.reg_no}` : '', s.vat_no ? `VAT ${s.vat_no}` : ''].filter(Boolean).join('  ·  ')
  pages.forEach((p, i) => {
    const y = MARGIN / 2
    p.drawText(cleanFor(regular, left), { x: MARGIN, y, size: 7, font: regular, color: MUTED })
    if (pages.length > 1) {
      const label = `Page ${i + 1} of ${pages.length}`
      p.drawText(label, { x: A4.w - MARGIN - regular.widthOfTextAtSize(label, 7), y, size: 7, font: regular, color: MUTED })
    }
  })
}

export async function buildDocumentPdf(input: {
  letterhead: Letterhead
  title: string
  body: string
  signable: boolean
  clientName?: string | null
  signed?: SignedMark | null
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(input.title)
  pdf.setAuthor(input.letterhead.name ?? '')
  pdf.setCreator('Remus')
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const k: Kit = { pdf, regular, bold, page: pdf.addPage([A4.w, A4.h]), y: A4.h - MARGIN }
  await letterhead(k, input.letterhead)
  body(k, input.body)
  if (input.signed) await signedBlock(k, input.signed)
  else if (input.signable) paperSignatures(k, input.letterhead.name ?? 'the company', input.clientName ?? '')
  footers(pdf, regular, input.letterhead)
  return pdf.save()
}

/**
 * A SIGNED QUOTE: the quote's own PDF with a last page that says it was accepted, and the signature block.
 * The quote PDF is drawn from the quote as it is now; the fingerprint is of the words frozen when it was sent,
 * and the server refused the signature if the quote had changed in between.
 */
export async function appendSignedPage(pdfBytes: Uint8Array, input: { letterhead: Letterhead; title: string; mark: SignedMark }): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const k: Kit = { pdf, regular, bold, page: pdf.addPage([A4.w, A4.h]), y: A4.h - MARGIN }
  await letterhead(k, input.letterhead)
  body(k, `# Acceptance\n**${input.title}**\n\nThe client accepted this quotation by signing it online.`)
  await signedBlock(k, input.mark)
  return pdf.save()
}
