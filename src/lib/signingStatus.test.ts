import { describe, expect, it } from 'vitest'
import { latestFor, signingStatus, signingWhatsAppMessage, type SigningRequestRow } from './signingStatus'

const now = Date.parse('2026-11-07T10:00:00Z')
const row = (over: Partial<SigningRequestRow>): SigningRequestRow => ({
  id: 'r', source: 'document', document_id: 'd', quote_id: null, variation_id: null, project_id: 'p', title: 'Contract',
  signer_name: null, signer_email: null, state: 'sent', expires_at: '2026-11-20T00:00:00Z', opened_at: null, open_count: 0,
  signed_at: null, signed_name: null, signed_ip: null, emailed_at: null, copy_sent_at: null, created_by: null, created_at: '2026-11-06T00:00:00Z', ...over,
})

describe('where a signing link stands', () => {
  it('sent, opened, signed, expired, withdrawn', () => {
    expect(signingStatus(row({}), now)).toBe('sent')
    expect(signingStatus(row({ opened_at: '2026-11-06T12:00:00Z' }), now)).toBe('opened')
    expect(signingStatus(row({ state: 'signed', expires_at: '2026-11-01T00:00:00Z' }), now)).toBe('signed')
    expect(signingStatus(row({ expires_at: '2026-11-07T09:00:00Z' }), now)).toBe('expired')
    expect(signingStatus(row({ state: 'cancelled' }), now)).toBe('cancelled')
  })
  it('the newest request for a thing is its status', () => {
    const rows = [row({ id: 'old', created_at: '2026-11-01T00:00:00Z' }), row({ id: 'new', created_at: '2026-11-05T00:00:00Z' }), row({ id: 'other', document_id: 'x', created_at: '2026-11-06T00:00:00Z' })]
    expect(latestFor(rows, (r) => r.document_id === 'd')?.id).toBe('new')
    expect(latestFor(rows, (r) => r.document_id === 'none')).toBeNull()
  })
  it('the WhatsApp message carries the link', () => {
    expect(signingWhatsAppMessage({ firstName: 'Thandi', senderName: 'Stephan', companyName: 'Urban Haus', title: 'the contract', url: 'https://x/sign/a' }))
      .toBe('Good day Thandi, this is Stephan from Urban Haus. Please read and sign the contract here: https://x/sign/a')
  })
})
