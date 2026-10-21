import { describe, expect, it } from 'vitest'
import { applyMapping, guessMapping, parseAmount, parseBankDate, parseBankTable, parseCsvRows, parseOfx, parseOfxDate } from './bankCsv'

describe('parseAmount', () => {
  it.each([
    ['-1234.56', -1234.56],
    ['R 1 234.56', 1234.56],
    ['1,234.56', 1234.56],
    ['-1234,56', -1234.56],
    ['(500.00)', -500],
    ['250.00 Dr', -250],
    ['250.00 Cr', 250],
    ['100.00-', -100],
    ['1234.56CR', 1234.56],
    ['1234.56DR', -1234.56],
    ['1234.56Dr.', -1234.56],
    ['ZAR 1 234.56', 1234.56],
    ['-R50.00', -50],
    ['R-50.00', -50],
    ['(R 500.00)', -500],
    ['\u221250.00', -50],
    ['1.234,56', 1234.56],
    ['-1.234.567,89', -1234567.89],
    ['1 234.56', 1234.56],
    ['R', null],
    ['-', null],
    ['', null],
    ['abc', null],
  ])('%s -> %s', (raw, want) => {
    expect(parseAmount(raw)).toBe(want)
  })
})

describe('parseBankDate', () => {
  it('reads SA bank date formats', () => {
    expect(parseBankDate('2026/10/03')).toBe('2026-10-03')
    expect(parseBankDate('20261003')).toBe('2026-10-03')
    expect(parseBankDate('03/10/2026')).toBe('2026-10-03') // day first
    expect(parseBankDate('03 Oct 2026')).toBe('2026-10-03')
    expect(parseBankDate('3-Oct-26')).toBe('2026-10-03')
    expect(parseBankDate('10/03/2026', 'mdy')).toBe('2026-10-03')
    expect(parseBankDate('31/02/2026')).toBeNull()
    expect(parseBankDate('Closing balance')).toBeNull()
  })

  it('reads dates without separators and month-first names', () => {
    expect(parseBankDate('01Oct2026')).toBe('2026-10-01')
    expect(parseBankDate('1Oct26')).toBe('2026-10-01')
    expect(parseBankDate('Oct 01 2026')).toBe('2026-10-01')
    expect(parseBankDate('October 1, 2026')).toBe('2026-10-01')
    expect(parseBankDate('Foo 01 2026')).toBeNull()
  })

  it("treats the old 'ymd' format as auto (day first)", () => {
    expect(parseBankDate('03/10/2026', 'ymd')).toBe('2026-10-03')
    expect(parseBankDate('2026/10/03', 'ymd')).toBe('2026-10-03')
  })
})

describe('parseCsvRows', () => {
  it('handles quotes, embedded delimiters, semicolons and BOM', () => {
    expect(parseCsvRows('﻿a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ])
    expect(parseCsvRows('Date;Amount;Description\n2026-01-01;-10,50;X')).toEqual([
      ['Date', 'Amount', 'Description'],
      ['2026-01-01', '-10,50', 'X'],
    ])
  })

  it('keeps a quote inside an unquoted field literal', () => {
    expect(parseCsvRows('2026/10/01,12" PIPE,-50.00\n2026/10/02,"A, B",-10.00')).toEqual([
      ['2026/10/01', '12" PIPE', '-50.00'],
      ['2026/10/02', 'A, B', '-10.00'],
    ])
  })
})

const FNB = `ACCOUNT TRANSACTIONS
Name:,BUILDCO CONSTRUCTION
Account:,62000000000
Date,Amount,Balance,Description
2026/10/01,-1523.45,10476.55,POS PURCHASE BUILDERS WAREHOUSE MIDRAND
2026/10/02,25000.00,35476.55,ACB CREDIT SMITH INV-0004
2026/10/02,-50.00,35426.55,TOLL GATE
2026/10/02,-50.00,35376.55,TOLL GATE
`

const ABSA_DEBIT_CREDIT = `Transaction Date,Description,Debit Amount,Credit Amount,Balance
03/10/2026,CASHBLD PRETORIA,"1,200.00",,9 000.00
04/10/2026,DEPOSIT,,"5,000.00",14 000.00
`

describe('bank table import', () => {
  it('skips FNB preamble and guesses mapping', () => {
    const t = parseBankTable(FNB)
    expect(t.headers).toEqual(['Date', 'Amount', 'Balance', 'Description'])
    const m = guessMapping(t.headers)
    expect(m).toMatchObject({ date: 'Date', amount: 'Amount', balance: 'Balance', description: 'Description' })
    const r = applyMapping(t, m)
    expect(r.errors).toEqual([])
    expect(r.transactions).toHaveLength(4)
    expect(r.transactions[0]).toMatchObject({ date: '2026-10-01', amount: -1523.45, balance: 10476.55 })
    // Two identical toll rows are both kept, with distinct keys.
    expect(new Set(r.transactions.map((x) => x.external_id)).size).toBe(4)
  })

  it('maps separate debit/credit columns', () => {
    const t = parseBankTable(ABSA_DEBIT_CREDIT)
    const m = guessMapping(t.headers)
    expect(m.debit).toBe('Debit Amount')
    expect(m.credit).toBe('Credit Amount')
    const r = applyMapping(t, m)
    expect(r.transactions.map((x) => x.amount)).toEqual([-1200, 5000])
    expect(r.transactions[0].date).toBe('2026-10-03')
  })

  it('skips zero-amount and balance lines without reporting errors', () => {
    const csv = `Date,Description,Debit,Credit,Balance
01/10/2026,Opening balance,,,1000.00
02/10/2026,CASHBUILD,100.00,,900.00
03/10/2026,NOTHING,0.00,0.00,900.00
04/10/2026,BLANK,,,900.00
,Closing balance,,,900.00
`
    const t = parseBankTable(csv)
    const r = applyMapping(t, guessMapping(t.headers, t.rows))
    expect(r.errors).toEqual([])
    expect(r.transactions.map((x) => x.amount)).toEqual([-100])
    expect(r.skipped).toBe(4)
  })

  it('does not take a data row as the header', () => {
    const csv = `Statement for 01/10/2026 to 31/10/2026
2026/10/01,Transaction fee,Debit order,-5.00
2026/10/02,Credit transfer,Reference ABC,250.00
`
    const t = parseBankTable(csv)
    expect(t.headerIndex).toBe(-1)
    expect(t.headers[0]).toBe('Column 1')
  })

  it('reads header-less Standard Bank HIST files', () => {
    const csv = `HIST,20261001,,-1250.00,CASHBUILD PRETORIA,REF1,8750.00,
HIST,20261002,,5000.00,SMITH INV-0004,REF2,13750.00,
HIST,20261003,,-60.00,TOLL GATE,REF3,13690.00,
`
    const t = parseBankTable(csv)
    expect(t.headerIndex).toBe(-1)
    expect(t.rows).toHaveLength(3)
    const m = guessMapping(t.headers, t.rows)
    expect(m).toMatchObject({ date: 'Column 2', amount: 'Column 4', description: 'Column 5', balance: 'Column 7' })
    const r = applyMapping(t, m)
    expect(r.errors).toEqual([])
    expect(r.transactions[0]).toMatchObject({ date: '2026-10-01', amount: -1250, description: 'CASHBUILD PRETORIA', balance: 8750 })
    expect(r.transactions[0].external_id.startsWith('csv:')).toBe(true)
  })

  it('adds a Capitec fee column to the debit', () => {
    const csv = `Nr,Account,Posting Date,Transaction Date,Description,Money In,Money Out,Fee,Balance
1,123,2026-10-01,2026-10-01,CASHBUILD,,-150.00,-2.50,847.50
2,123,2026-10-02,2026-10-02,MONTHLY FEE,,,-7.50,840.00
3,123,2026-10-03,2026-10-03,DEPOSIT,500.00,,,1340.00
`
    const t = parseBankTable(csv)
    const m = guessMapping(t.headers, t.rows)
    expect(m).toMatchObject({ debit: 'Money Out', credit: 'Money In', fee: 'Fee' })
    expect(applyMapping(t, m).transactions.map((x) => x.amount)).toEqual([-152.5, -7.5, 500])
  })

  it('applies a separate D/C indicator to an unsigned amount', () => {
    const csv = `Date,Description,Amount,Dr/Cr
2026/10/01,CASHBUILD,150.00,D
2026/10/02,DEPOSIT,500.00,C
2026/10/03,FEE,5.00,Debit
`
    const t = parseBankTable(csv)
    const m = guessMapping(t.headers, t.rows)
    expect(m).toMatchObject({ amount: 'Amount', signColumn: 'Dr/Cr', debit: undefined, credit: undefined })
    expect(applyMapping(t, m).transactions.map((x) => x.amount)).toEqual([-150, 500, -5])
  })

  it('keys on date, amount and description only', () => {
    const a = applyMapping(parseBankTable('Date,Description,Amount,Reference\n2026/10/01,TOLL,-50.00,A1'), { date: 'Date', description: 'Description', amount: 'Amount', reference: 'Reference', dateFormat: 'auto' })
    const b = applyMapping(parseBankTable('Date,Description,Amount,Reference\n2026/10/01,TOLL,-50.00,B2'), { date: 'Date', description: 'Description', amount: 'Amount', reference: 'Reference', dateFormat: 'auto' })
    expect(a.transactions[0].external_id).toBe(b.transactions[0].external_id)
  })

  it('produces the same key for the same row on re-import', () => {
    const a = applyMapping(parseBankTable(FNB), guessMapping(parseBankTable(FNB).headers))
    const b = applyMapping(parseBankTable(FNB), guessMapping(parseBankTable(FNB).headers))
    expect(a.transactions.map((x) => x.external_id)).toEqual(b.transactions.map((x) => x.external_id))
  })
})

describe('parseOfx', () => {
  it('reads STMTTRN blocks', () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005120000<TRNAMT>-899.99<FITID>ABC123<NAME>CASHBUILD<MEMO>Card purchase</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`
    const r = parseOfx(ofx)
    expect(r.transactions).toEqual([
      { date: '2026-10-05', description: 'CASHBUILD Card purchase', amount: -899.99, balance: null, reference: null, external_id: 'ofx:ABC123' },
    ])
  })

  it('keeps identical lines without FITID apart and decodes entities', () => {
    const line = '<STMTTRN><DTPOSTED>20261005<TRNAMT>-50.00<NAME>TOLL &amp; GATE</STMTTRN>'
    const r = parseOfx(`OFXHEADER:100\n<OFX>${line}${line}<STMTTRN><DTPOSTED>20261005<TRNAMT>0.00<NAME>X</STMTTRN></OFX>`)
    expect(r.transactions).toHaveLength(2)
    expect(r.transactions[0].description).toBe('TOLL & GATE')
    expect(r.transactions[0].external_id.startsWith('csv:')).toBe(false)
    expect(new Set(r.transactions.map((x) => x.external_id)).size).toBe(2)
    expect(r.skipped).toBe(1)
  })

  it('converts DTPOSTED with a timezone offset to the SA date', () => {
    expect(parseOfxDate('20261005')).toBe('2026-10-05')
    expect(parseOfxDate('20261005230000')).toBe('2026-10-05')
    expect(parseOfxDate('20261005230000[0:GMT]')).toBe('2026-10-06')
    expect(parseOfxDate('20261005210000.000[-5:EST]')).toBe('2026-10-06')
    expect(parseOfxDate('20261006010000[+2:SAST]')).toBe('2026-10-06')
    expect(parseOfxDate('20261006010000[+5.5:IST]')).toBe('2026-10-05')
  })
})
