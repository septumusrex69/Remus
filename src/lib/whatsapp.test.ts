import { describe, expect, it } from 'vitest'
import { quoteWhatsAppMessage, whatsAppLink, whatsAppNumber } from './whatsapp'

describe('WhatsApp numbers', () => {
  it('turns a South African cellphone into the international form', () => {
    expect(whatsAppNumber('082 123 4567')).toBe('27821234567')
    expect(whatsAppNumber('+27 82 123 4567')).toBe('27821234567')
    expect(whatsAppNumber('0027821234567')).toBe('27821234567')
  })
  it('leaves out a landline and rubbish', () => {
    expect(whatsAppNumber('012 345 6789')).toBeNull()
    expect(whatsAppNumber('12345')).toBeNull()
    expect(whatsAppNumber(null)).toBeNull()
  })
  it('keeps another country written internationally', () => {
    expect(whatsAppNumber('+44 7700 900123')).toBe('447700900123')
  })
  it('builds the link, with or without a number', () => {
    expect(whatsAppLink('27821234567', 'Hi there')).toBe('https://wa.me/27821234567?text=Hi%20there')
    expect(whatsAppLink(null)).toBe('https://wa.me/')
  })
  it('the message names the company and the quote', () => {
    expect(quoteWhatsAppMessage({ firstName: 'Piet', senderName: 'Stephan', companyName: 'Urban Haus Group', quoteNumber: 'Q-0012', title: 'Bathroom' }))
      .toBe('Good day Piet, this is Stephan from Urban Haus Group. Please find our quotation (Q-0012, Bathroom) attached. Let me know if you have any questions.')
  })
})
