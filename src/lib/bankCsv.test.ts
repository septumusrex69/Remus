import { describe, expect, it } from 'vitest'
import { applyMapping, guessMapping, parseAmount, parseBankDate, parseBankTable, parseCsvRows, parseOfx } from './bankCsv'

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
})
