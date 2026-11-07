import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { ageingBucketFor, buildStatement, clientPayments, daysBetween, STATEMENT_BUCKETS, statementFileName, type StatementInvoice, type StatementPayment } from '../../api/_lib/statement'
import { buildStatementPdf, periodWords } from '../../api/_lib/statementPdf'
import { readStatementAsk, profileSeesMoney } from '../../api/_lib/statementSend'
import { AGEING_BUCKETS, ageingBucket } from './finance'
import { statementClientFor, statementRange, statementUrl, statementWhatsAppMessage } from './statement'

/*
 * THE STATEMENT OF ACCOUNT (Remus · Handover 8). The arithmetic lives in api/_lib/statement.ts, beside the PDF;
 * these hold it to Finance's (src/lib/finance.ts) so the statement a client gets and the Finance page agree.
 */
const inv = (id: string, issue: string, excl: number, over: Partial<StatementInvoice> = {}): StatementInvoice => ({
  id, number: `INV-${id}`, issue_date: issue, due_date: null, description: null, amount_excl: excl, vat: Math.round(excl * 15) / 100, status: 'sent', ...over,
})
const pay = (id: string, date: string, amount: number, invoice_id: string | null = null): StatementPayment => ({ id, invoice_id, date, amount, method: 'eft', reference: null })

describe('statement of account', () => {
  it('uses the same ageing words and limits as Finance', () => {
    expect([...STATEMENT_BUCKETS]).toEqual([...AGEING_BUCKETS])
    for (const d of [-5, 0, 1, 30, 31, 60, 61, 90, 91, 400]) expect(ageingBucketFor(d)).toBe(ageingBucket(d))
    expect(daysBetween('2026-10-31', '2026-11-07')).toBe(7)
    expect(daysBetween('2026-11-07', '2026-11-01')).toBe(-6)
  })

  it('brings the balance forward, runs it line by line, and leaves out drafts and cancelled invoices', () => {
    const st = buildStatement({
      invoices: [
        inv('1', '2026-06-01', 1000), // R 1 150 before the period
        inv('2', '2026-09-10', 2000), // R 2 300 in it
        inv('3', '2026-09-12', 500, { status: 'draft' }),
        inv('4', '2026-09-13', 500, { status: 'cancelled' }),
      ],
      payments: [pay('a', '2026-07-01', 150, '1'), pay('b', '2026-09-20', 1000, '1')],
      from: '2026-08-01', to: '2026-10-31', today: '2026-11-07',
    })
    expect(st.opening).toBe(1000)
    expect(st.lines.map((l) => [l.debit, l.credit, l.balance])).toEqual([[2300, 0, 3300], [0, 1000, 2300]])
    expect(st.lines[1].detail).toBe('Payment received (EFT) · against INV-1')
    expect(st.invoiced).toBe(2300)
    expect(st.received).toBe(1000)
    expect(st.closing).toBe(2300)
    expect(st.asAt).toBe('2026-10-31')
    expect(st.due).toBe(2300)
  })

  it('ages what is owed as at the statement date and takes loose payments off the oldest first', () => {
    const st = buildStatement({
      invoices: [inv('1', '2026-07-01', 1000), inv('2', '2026-10-20', 1000)], // R 1 150 each
      payments: [pay('a', '2026-10-01', 400)], // on the job, no invoice named
      from: null, to: '2026-11-30', today: '2026-11-07',
    })
    expect(st.asAt).toBe('2026-11-07')
    const by = Object.fromEntries(st.ageing.map((a) => [a.bucket, a.amount]))
    expect(by['90+ days']).toBe(750) // 1 July is 129 days back; the R 400 came off it
    expect(by['1–30 days']).toBe(1150) // 20 Oct is 18 days back
    expect(st.due).toBe(1900)
    expect(st.due).toBe(st.closing)
    expect(st.inCredit).toBe(0)
  })

  it('says when a client is in credit', () => {
    const st = buildStatement({ invoices: [inv('1', '2026-10-01', 100)], payments: [pay('a', '2026-10-02', 200, '1')], from: null, to: '2026-11-07', today: '2026-11-07' })
    expect(st.closing).toBe(-85)
    expect(st.due).toBe(0)
    expect(st.inCredit).toBe(85)
  })

  it("takes a client's payments: against its invoices, or on its jobs with no invoice named", () => {
    const ps = [
      { ...pay('a', '2026-10-01', 1, 'mine'), project_id: null },
      { ...pay('b', '2026-10-01', 1, 'theirs'), project_id: 'job1' },
      { ...pay('c', '2026-10-01', 1, null), project_id: 'job1' },
      { ...pay('d', '2026-10-01', 1, null), project_id: 'job2' },
    ]
    expect(clientPayments(ps, new Set(['mine']), new Set(['job1'])).map((p) => p.id)).toEqual(['a', 'c'])
  })

  it('draws a PDF that opens, with a page for a long account', async () => {
    const invoices = Array.from({ length: 60 }, (_, i) => inv(String(i), `2026-0${1 + (i % 9)}-1${i % 10}`, 1000 + i))
    const st = buildStatement({ invoices, payments: [pay('p', '2026-05-05', 5000)], from: '2026-01-01', to: '2026-10-31', today: '2026-11-07' })
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch // no logo: falls back to the name
    try {
      const out = await buildStatementPdf({
        client: { name: 'Acme Builders (Pty) Ltd', attention: 'Thandi Mokoena', address: '1 Main Rd\nSandton', email: 'a@b.co.za', phone: null, vatNo: '4123' },
        settings: { name: 'Urban Haus Construction', phone: '011 555 0000', email: 'office@urbanhausgroup.co.za', bank_details: 'FNB\nAcc 123 456 789\nBranch 250655' },
        statement: st,
      })
      const doc = await PDFDocument.load(out.bytes)
      expect(doc.getPageCount()).toBeGreaterThan(1)
      expect(out.filename).toBe('Statement-Acme-Builders-Pty-Ltd-2026-10-31.pdf')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('names the period and the file plainly', () => {
    expect(periodWords({ from: '2026-08-01', to: '2026-10-31' })).toBe('1 Aug 2026 to 31 Oct 2026')
    expect(periodWords({ from: null, to: '2026-10-31' })).toBe('Up to 31 Oct 2026')
    expect(statementFileName('  ', '2026-11-07')).toBe('Statement-client-2026-11-07.pdf')
  })

  it('is for the people who see the money; asks are read strictly', () => {
    expect(profileSeesMoney({ role: 'Administrator', status: 'Active' })).toBe(true)
    expect(profileSeesMoney({ role: 'Read Only', status: 'Active' })).toBe(true)
    expect(profileSeesMoney({ role: 'Sales Representative', status: 'Active' })).toBe(false)
    expect(profileSeesMoney({ role: 'Administrator', status: 'Inactive' })).toBe(false)
    expect(readStatementAsk({ kind: 'company', id: 'x', from: '2026-01-01', to: 'nope' })).toEqual({ kind: 'company', id: 'x', from: '2026-01-01', to: null })
    expect(readStatementAsk({ kind: 'debtor', id: 'x' })).toBeNull()
  })

  it('builds the browser side: range, link, who it goes to, the WhatsApp words', () => {
    const now = new Date(2026, 10, 7)
    expect(statementRange('all', now)).toEqual({ from: null, to: '2026-11-30' })
    expect(statementRange('last_3', now)).toEqual({ from: '2026-09-01', to: '2026-11-30' })
    expect(statementUrl({ kind: 'contact', id: 'c1', from: null, to: '2026-11-30' })).toBe('/api/quotes/pdf?statement=contact&client=c1&to=2026-11-30')
    const c = statementClientFor('company', { id: 'co', name: 'Acme', email: null, phone: '011 555 0000' }, [
      { first_name: 'Thandi', last_name: 'M', email: 'thandi@acme.co.za', mobile: '082 123 4567', phone: null },
    ])
    expect(c.email).toBe('thandi@acme.co.za')
    expect(c.firstName).toBe('Thandi')
    expect(c.numbers.map((n) => n.value)).toEqual(['082 123 4567', '011 555 0000'])
    expect(statementWhatsAppMessage({ firstName: 'Thandi', senderName: 'Stephan', companyName: 'Urban Haus Construction' }))
      .toBe('Good day Thandi, this is Stephan from Urban Haus Construction. Please find your statement of account attached. Let me know if you have any questions.')
  })
})
