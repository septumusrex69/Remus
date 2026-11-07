import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { appendSignedPage, buildDocumentPdf } from './documentPdf.js'
import {
  SIGNING_DAYS_DEFAULT, SIGNING_DAYS_MAX, callerIp, cleanSignerName, documentHash, isSignaturePng, isSigningToken, newSigningToken,
  pdfName, quoteSigningText, signSubmitProblem, signingClosedReason, signingDays, signingEmail, signingLink, variationSigningText,
} from './signingRules.js'

/* A 1x1 PNG, as a signature pad's data URL would be. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe("the signing link (Raptor's token rules)", () => {
  it('is 256 random bits, URL-safe, never padded, never the same twice', () => {
    const a = newSigningToken()
    const b = newSigningToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(isSigningToken(a)).toBe(true)
    expect(isSigningToken('short')).toBe(false)
    expect(isSigningToken(`${a}=`)).toBe(false)
    expect(isSigningToken(null)).toBe(false)
  })
  it('builds an absolute link on the deployment it was made on', () => {
    expect(signingLink('abc', 'https://remus-xi.vercel.app/')).toBe('https://remus-xi.vercel.app/sign/abc')
  })
  it('keeps the days within reason', () => {
    expect(signingDays(undefined)).toBe(SIGNING_DAYS_DEFAULT)
    expect(signingDays(0)).toBe(SIGNING_DAYS_DEFAULT)
    expect(signingDays(7)).toBe(7)
    expect(signingDays(1000)).toBe(SIGNING_DAYS_MAX)
  })
})

describe('what was signed', () => {
  it('fingerprints the words the same whatever the line endings', () => {
    expect(documentHash('a\r\nb')).toBe(documentHash('a\nb'))
    expect(documentHash('a\nb')).toMatch(/^[0-9a-f]{64}$/)
    expect(documentHash('R 100.00')).not.toBe(documentHash('R 100.01'))
  })
  it('writes a quote out so that any change in a line, total or term changes the fingerprint', () => {
    const base = {
      number: 'Q0001', title: 'Kitchen', site_address: '2 Client Road', issue_date: '2026-11-01', valid_until: '2026-12-01', terms: 'Pay in 7 days.',
      client: 'Thandi', items: [{ section: 'Kitchen', description: 'Cupboards', quantity: 2, unit: 'each', unit_price: 1000 }],
      totals: { totalExcl: 2000, vat: 300, totalIncl: 2300, vatRate: 15 },
    }
    const text = quoteSigningText(base)
    expect(text).toContain('Cupboards: 2 each at R 1 000.00 = R 2 000.00')
    expect(text).toContain('**Total: R 2 300.00**')
    expect(text).toContain('Pay in 7 days.')
    expect(documentHash(quoteSigningText({ ...base, items: [{ ...base.items[0], quantity: 3 }] }))).not.toBe(documentHash(text))
    expect(documentHash(quoteSigningText({ ...base, terms: 'Pay in 30 days.' }))).not.toBe(documentHash(text))
  })
  it('writes a variation with and without VAT', () => {
    const v = { description: 'Extra window', amount_excl: 1000, date: '2026-11-07', project: 'Kitchen', site: null, client: 'Thandi', company: 'Urban Haus' }
    expect(variationSigningText({ ...v, vatRate: 15 })).toContain('R 1 000.00 excluding VAT (R 1 150.00 including VAT)')
    expect(variationSigningText({ ...v, vatRate: 0 })).not.toContain('including VAT')
  })
})

describe('signing it', () => {
  it('asks for a name, a drawn signature and the tick, each in so many words', () => {
    expect(signSubmitProblem({ name: '', signature: PNG, agreed: true })).toMatch(/full name/)
    expect(signSubmitProblem({ name: 'Thandi Client', signature: 'nope', agreed: true })).toMatch(/Sign in the box/)
    expect(signSubmitProblem({ name: 'Thandi Client', signature: PNG, agreed: false })).toMatch(/Tick the box/)
    expect(signSubmitProblem({ name: 'Thandi Client', signature: PNG, agreed: 'yes' })).toMatch(/Tick the box/)
    expect(signSubmitProblem({ name: 'Thandi Client', signature: PNG, agreed: true })).toBeNull()
  })
  it('takes only a PNG from the pad, and not a huge one', () => {
    expect(isSignaturePng(PNG)).toBe(true)
    expect(isSignaturePng('data:image/svg+xml;base64,AAAA')).toBe(false)
    expect(isSignaturePng(`data:image/png;base64,${'A'.repeat(500_000)}`)).toBe(false)
  })
  it('cleans a typed name to one line', () => {
    expect(cleanSignerName('  Thandi \n  Client ')).toBe('Thandi Client')
    expect(cleanSignerName(5)).toBe('')
  })
  it('says why a link is closed: signed, withdrawn, expired', () => {
    const now = Date.parse('2026-11-07T10:00:00Z')
    expect(signingClosedReason({ state: 'sent', expires_at: '2026-11-08T00:00:00Z' }, now)).toBeNull()
    expect(signingClosedReason({ state: 'sent', expires_at: '2026-11-07T09:00:00Z' }, now)).toMatch(/expired/)
    expect(signingClosedReason({ state: 'signed', expires_at: '2026-11-08T00:00:00Z' }, now)).toMatch(/already been signed/)
    expect(signingClosedReason({ state: 'cancelled', expires_at: '2026-11-08T00:00:00Z' }, now)).toMatch(/withdrawn/)
  })
  it("records the caller's own address, the first one Vercel forwards", () => {
    expect(callerIp({ 'x-forwarded-for': '41.13.2.9, 10.0.0.1' })).toBe('41.13.2.9')
    expect(callerIp({ 'x-real-ip': '41.13.2.9' })).toBe('41.13.2.9')
    expect(callerIp({})).toBe('')
  })
})

describe('the signing email', () => {
  it('has a button and the address in words, and escapes what it is given', () => {
    const m = signingEmail({ company: 'Urban Haus', signerName: 'Thandi', title: 'Building <contract>', url: 'https://x.test/sign/abc', expiresAt: '2026-11-21T10:00:00Z', from: 'Stephan' })
    expect(m.subject).toBe('Please sign: Building <contract>')
    expect(m.html).toContain('href="https://x.test/sign/abc"')
    expect(m.html).toContain('Building &lt;contract&gt;')
    expect(m.html).not.toContain('<contract>')
    expect(m.text).toContain('https://x.test/sign/abc')
    expect(m.text).toContain('21 Nov 2026')
  })
})

describe('the PDF on the letterhead', () => {
  it("draws a document, and a signed one, without failing on characters Helvetica lacks", async () => {
    const letterhead = { name: 'Urban Haus Construction', address: '1 Main Road\nPretoria', reg_no: '2020/1/07', vat_no: '4123', logo_url: PNG }
    const body = '# BUILDING CONTRACT\n\n**The client:** Thandi – “quoted” ✓\n## 1. The work\n- A bullet\nA plain line\n\n'
    const plain = await buildDocumentPdf({ letterhead, title: 'Contract', body, signable: true, clientName: 'Thandi' })
    expect((await PDFDocument.load(plain)).getPageCount()).toBe(1)
    const signed = await buildDocumentPdf({ letterhead, title: 'Contract', body: body.repeat(30), signable: true, signed: { name: 'Thandi', at: '2026-11-07T12:05:00Z', ip: '41.13.2.9', pngDataUrl: PNG, hash: 'a'.repeat(64), reference: 'r1' } })
    expect((await PDFDocument.load(signed)).getPageCount()).toBeGreaterThan(1)
    const withPage = await appendSignedPage(plain, { letterhead, title: 'Quotation Q1', mark: { name: 'Thandi', at: '2026-11-07T12:05:00Z', ip: null, pngDataUrl: PNG, hash: 'b'.repeat(64), reference: 'r2' } })
    expect((await PDFDocument.load(withPage)).getPageCount()).toBe(2)
  })
  it('names the file plainly', () => {
    expect(pdfName('Building contract: Kitchen at 2 Client Road', true)).toBe('Building_contract_Kitchen_at_2_Client_Road-signed.pdf')
    expect(pdfName('***', false)).toBe('Document.pdf')
  })
})
