/**
 * WHERE A SIGNING LINK STANDS, AS THE OFFICE SEES IT (Remus · Handover 8). The task: "the office sees status
 * (sent / opened / signed)". Raptor's SigningPanel shows sent / signed; Remus also records the first opening,
 * and every link expires, so there are five. PURE, so a test can hold it.
 */
export interface SigningRequestRow {
  id: string
  source: 'document' | 'quote' | 'variation'
  document_id: string | null
  quote_id: string | null
  variation_id: string | null
  project_id: string | null
  title: string
  signer_name: string | null
  signer_email: string | null
  state: 'sent' | 'signed' | 'cancelled'
  expires_at: string
  opened_at: string | null
  open_count: number
  signed_at: string | null
  signed_name: string | null
  signed_ip: string | null
  emailed_at: string | null
  copy_sent_at: string | null
  created_by: string | null
  created_at: string
}

export type SigningStatus = 'signed' | 'opened' | 'sent' | 'expired' | 'cancelled'

export function signingStatus(r: Pick<SigningRequestRow, 'state' | 'expires_at' | 'opened_at'>, nowMs = Date.now()): SigningStatus {
  if (r.state === 'signed') return 'signed'
  if (r.state === 'cancelled') return 'cancelled'
  if (Date.parse(r.expires_at) <= nowMs) return 'expired'
  return r.opened_at ? 'opened' : 'sent'
}

export const SIGNING_STATUS: Record<SigningStatus, { label: string; tone: string }> = {
  signed: { label: 'Signed', tone: 'bg-emerald-50 text-emerald-700' },
  opened: { label: 'Opened', tone: 'bg-brand-50 text-brand-700' },
  sent: { label: 'Sent', tone: 'bg-slate-100 text-slate-600' },
  expired: { label: 'Expired', tone: 'bg-amber-50 text-amber-700' },
  cancelled: { label: 'Withdrawn', tone: 'bg-slate-100 text-slate-400' },
}

/** The newest request for one thing, which is the one its status is. */
export function latestFor(rows: SigningRequestRow[], match: (r: SigningRequestRow) => boolean): SigningRequestRow | null {
  return rows.filter(match).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}

/** The message that goes with a signing link on WhatsApp, edited there before it is sent. */
export function signingWhatsAppMessage(input: { firstName?: string | null; senderName?: string | null; companyName?: string | null; title: string; url: string }): string {
  const hello = input.firstName?.trim() ? `Good day ${input.firstName.trim()}` : 'Good day'
  const company = input.companyName?.trim() || 'Urban Haus'
  const who = input.senderName?.trim() ? `this is ${input.senderName.trim()} from ${company}` : `this is ${company}`
  return `${hello}, ${who}. Please read and sign ${input.title} here: ${input.url}`
}
