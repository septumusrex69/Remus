/**
 * WHATSAPP A QUOTE (Remus · Handover 6, from Raptor's `src/lib/whatsapp.ts`). Stephan, 27 Oct: "send the PDF
 * file itself, that's the best one ... like share it". So on a phone or iPad the PDF goes through the share
 * sheet (pick WhatsApp there); on a computer, which cannot share a file, the PDF is downloaded and WhatsApp
 * opens on the client's cellphone with the message typed in, to attach it. Sent from the person's own
 * WhatsApp: nothing paid per message, and Remus never sees the conversation.
 *
 * PURE, so the number rules are checked without a browser.
 */

/**
 * A number as wa.me wants it: digits only, country code first, no leading 0 or +. Only MOBILES (a
 * landline opens a chat that can never be delivered): South African mobiles start 06, 07 or 08. A number
 * already written internationally for another country is kept. Null where WhatsApp cannot reach it.
 */
export function whatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const intl = trimmed.startsWith('+') || trimmed.startsWith('00')
  let digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('00')) digits = digits.slice(2)
  if (!intl && digits.length === 10 && digits.startsWith('0')) digits = `27${digits.slice(1)}`
  if (digits.startsWith('27')) return digits.length === 11 && /^27[678]/.test(digits) ? digits : null
  return intl && digits.length >= 8 && digits.length <= 15 ? digits : null
}

/** Opens WhatsApp on that number (or on no number: WhatsApp asks whom), the message typed in. */
export function whatsAppLink(number: string | null, text?: string | null): string {
  const t = text?.trim()
  return `https://wa.me/${number ?? ''}${t ? `?text=${encodeURIComponent(t)}` : ''}`
}

/** The message that goes with the quote, edited in WhatsApp before it is sent -- never sent by itself. */
export function quoteWhatsAppMessage(input: {
  firstName?: string | null; senderName?: string | null; companyName?: string | null; quoteNumber?: string | null; title?: string | null
}): string {
  const hello = input.firstName ? `Good day ${input.firstName}` : 'Good day'
  const company = input.companyName?.trim() || 'Urban Haus'
  const who = input.senderName ? `this is ${input.senderName} from ${company}` : `this is ${company}`
  const what = [input.quoteNumber, input.title?.trim()].filter(Boolean).join(', ')
  return `${hello}, ${who}. Please find our quotation${what ? ` (${what})` : ''} attached. Let me know if you have any questions.`
}
