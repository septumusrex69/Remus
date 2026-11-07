import { describe, expect, it } from 'vitest'
import { GAP, MERGE_FIELDS, fieldsUsed, inlineRuns, mergeValues, needs, parseDocument, rand, renderTemplate, unknownFields } from './documentTemplates'

describe('merge fields', () => {
  it('finds the fields a template uses, once each, in order', () => {
    expect(fieldsUsed('Dear {{client_name}}, re {{ project_name }} for {{client_name}}', '{{quote_number}}')).toEqual(['client_name', 'project_name', 'quote_number'])
  })
  it('names the fields Remus cannot fill', () => {
    expect(unknownFields('{{client_name}} {{debtor_balance}}')).toEqual(['debtor_balance'])
  })
  it('fills what it knows and leaves a line to fill in for what it does not', () => {
    const r = renderTemplate('Dear {{client_name}}, the sum is {{contract_sum}}.', { client_name: 'Thandi', contract_sum: '' })
    expect(r.text).toBe(`Dear Thandi, the sum is ${GAP}.`)
    expect(r.missing).toEqual(['contract_sum'])
  })
  it('every field has an example, so "Example data" never shows a gap', () => {
    for (const f of MERGE_FIELDS) expect(f.example.trim(), f.key).not.toBe('')
  })
})

describe('filling from a job', () => {
  const ctx = {
    today: '2026-11-07', senderName: 'Stephan',
    company: { name: 'Urban Haus', vat_rate: 15, vat_registered: true, address: '1 Main Rd\nPretoria' },
    client: { name: 'Thandi Client', address: '2 Client Road' },
    project: { name: 'Kitchen', code: 'UH-001', site_address: '2 Client Road', start_date: '2026-10-05', end_date: null },
    quote: { number: 'Q0001', title: 'Kitchen', issue_date: '2026-09-20', deposit_pct: 50 },
    quoteTotals: { total_excl: 300000, vat: 45000, total_incl: 345000 },
    variation: { description: 'Extra window', amount_excl: 8500, date: '2026-11-01' },
    invoice: { number: 'INV3', issue_date: '2026-11-01', due_date: '2026-11-08', amount_excl: 50000, vat: 7500 },
    invoicePaid: 30000,
  }
  it('writes the amounts and dates as the quote PDF does', () => {
    const v = mergeValues(ctx)
    expect(v.today).toBe('7 Nov 2026')
    expect(v.contract_sum).toBe('R 345 000.00')
    expect(v.deposit_amount).toBe('R 172 500.00')
    expect(v.variation_amount_incl).toBe('R 9 775.00')
    expect(v.amount_outstanding).toBe('R 27 500.00')
    expect(v.company_address).toBe('1 Main Rd, Pretoria')
    expect(v.end_date).toBe('')
  })
  it('charges no VAT on a variation when the company is not registered', () => {
    expect(mergeValues({ ...ctx, company: { ...ctx.company, vat_registered: false } }).variation_amount_incl).toBe('R 8 500.00')
  })
  it('never says the client owes less than nothing', () => {
    expect(mergeValues({ ...ctx, invoicePaid: 99999 }).amount_outstanding).toBe('R 0.00')
  })
  it('asks for a variation or an invoice only when the wording uses one', () => {
    expect(needs('{{variation_amount}} {{contract_sum}}')).toEqual({ quote: true, variation: true, invoice: false })
    expect(needs('Dear {{client_name}}')).toEqual({ quote: false, variation: false, invoice: false })
  })
  it('rand matches the quote PDF', () => {
    expect(rand(-1234.5)).toBe('-R 1 234.50')
    expect(rand(null)).toBe('')
  })
})

describe('the markup', () => {
  it('reads headings, bullets, bold and gaps', () => {
    const b = parseDocument('# Title\n\n\n## Part\n- one **two**\nplain')
    expect(b.map((x) => x.type)).toEqual(['h1', 'gap', 'h2', 'li', 'line'])
    expect(inlineRuns('a **b** c')).toEqual([{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false }])
  })
})
