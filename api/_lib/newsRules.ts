import crypto from 'node:crypto'

/**
 * NEWS: WHO A NEWSLETTER GOES TO, AND WHAT THEY READ (Remus · Handover 8, 7 Nov 2026).
 *
 * Stephan, 7 Nov, agreeing to "email newsletters to clients (with sign-up and unsubscribe), e.g. 'We've finished a
 * job in Brooklyn'": "we can start with pretty much all of that."
 *
 * COPIED FROM RAPTOR's src/lib/marketing.ts (S10, 21-22 Oct; branch claude/sales-raptor-review-p1pzx2) and adapted:
 * Raptor's debt-collection firm sends to clients and LEADS; Remus has no leads, so the people who are not clients
 * are SUBSCRIBERS (marketing_subscribers, migration 0050). Raptor's prospect campaigns, warm-up and three sending
 * domains are left out: Remus sends news to its own clients and to people who asked for it.
 *
 * PURE: no database, no network. The server answers the screen's preview with exactly the function it sends with,
 * so the count somebody approves is the count that goes (Raptor's rule), and newsRules.test.ts holds the rules.
 *
 * POPIA s69 -- direct marketing by email -- is the rule this file carries, as Raptor reads it:
 *   s69(3) an existing CLIENT may be sent news of our own similar services, provided every message offers a way
 *          out: clients are IN by default and opt out (the "soft opt-in").
 *   s69(1)-(2) anybody else needs CONSENT, and may be asked for it ONCE: a subscriber gets news only once their yes
 *          is on record (when, and how), or the one INVITATION that asks for it.
 *   An objection holds until the person withdraws it: marketing_preferences, per ADDRESS, read when the list is
 *          drawn AND again the moment each chunk is sent.
 */

/* ------------------------------------------------------------------------------------------------ addresses */

/** One address, one way of writing it: what the de-duplication and the unsubscribe both key on. */
export function normaliseEmail(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').trim().toLowerCase()
}

/**
 * A SHAPE CHECK, NOT A PROMISE (Raptor). One bad address in a batch of a hundred makes Resend refuse all hundred,
 * so the obvious typos are kept off the list here and counted, rather than found by the send.
 */
export function isSendableEmail(email: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(email)
}

/* ------------------------------------------------------------------------------------------------ who it goes to */

export type CampaignKind = 'news' | 'invitation'

export const CAMPAIGN_KIND_LABELS: Record<CampaignKind, string> = {
  news: 'Newsletter',
  invitation: 'Invitation to sign up',
}

export function parseKind(raw: unknown): CampaignKind {
  return raw === 'invitation' ? 'invitation' : 'news'
}

/** Always a RULE over Remus's own records (Raptor's), never a typed list. */
export type Audience =
  | { kind: 'all_clients' }
  | { kind: 'clients_with_jobs' }
  | { kind: 'subscribers' }
  | { kind: 'everyone' }
  | { kind: 'lists'; listIds: string[] }

export const AUDIENCE_LABELS: Record<Audience['kind'], string> = {
  all_clients: 'All clients with an email',
  clients_with_jobs: 'Clients we have done a job for',
  subscribers: 'People who signed up',
  everyone: 'Clients and people who signed up',
  lists: 'An imported list',
}

/** Which lists an invitation may go to: only people who are not clients (a client never needs asking). */
export const INVITATION_AUDIENCES: Audience['kind'][] = ['subscribers', 'lists']

export function parseAudience(raw: unknown): Audience | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  switch (a.kind) {
    case 'all_clients': case 'clients_with_jobs': case 'subscribers': case 'everyone':
      return { kind: a.kind }
    case 'lists':
      return { kind: 'lists', listIds: Array.isArray(a.listIds) ? a.listIds.filter((x): x is string => typeof x === 'string').slice(0, 50) : [] }
    default:
      return null
  }
}

export function describeAudience(a: Audience, listNames?: Map<string, string>): string {
  if (a.kind !== 'lists') return AUDIENCE_LABELS[a.kind]
  if (!a.listIds.length) return 'An imported list (none chosen)'
  const names = a.listIds.map((id) => listNames?.get(id)).filter(Boolean)
  return names.length ? `List: ${names.join(', ')}` : `${a.listIds.length} imported ${a.listIds.length === 1 ? 'list' : 'lists'}`
}

export interface NewsCompany { id: string; name: string; email?: string | null }
export interface NewsContact { id: string; firstName: string; lastName?: string | null; email?: string | null; companyId?: string | null }
export interface NewsSubscriber {
  id: string; email: string; name?: string | null; company?: string | null; listId?: string | null
  consentAt?: string | null; consentHow?: string | null; consentNote?: string | null
}

export interface Recipient {
  email: string
  firstName: string | null
  companyName: string | null
  via: 'company' | 'contact' | 'subscriber'
  companyId?: string | null
  contactId?: string | null
  subscriberId?: string | null
  /** Why this person may be sent it, in words: POPIA's record, stored on the send. */
  basis: string
  /** The invitation: the one approach to somebody who has not said yes. */
  firstApproach: boolean
}

export type ExclusionReason =
  | 'unsubscribed' | 'undeliverable' | 'no consent recorded' | 'already invited once' | 'already said yes'
  | 'already a client' | 'no address' | 'address does not look right' | 'on the list twice'

export interface AudienceInput {
  audience: Audience
  kind: CampaignKind
  companies: NewsCompany[]
  contacts: NewsContact[]
  subscribers: NewsSubscriber[]
  /** Clients (company or contact ids) with at least one project: "clients we have done a job for". */
  clientsWithJobs: Set<string>
  /** Addresses that said stop or cannot be reached: email -> 'unsubscribed' | 'undeliverable'. */
  preferences: Map<string, 'unsubscribed' | 'undeliverable'>
  /** Subscribers already sent an invitation (once ever). */
  invitedSubscribers: Set<string>
}

export interface AudienceResult { recipients: Recipient[]; excluded: Partial<Record<ExclusionReason, number>> }

const firstWord = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] || null

const DAY = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' })
}

export const CLIENT_BASIS = 'Existing client (POPIA soft opt-in: our own similar services, with a way out in every email)'
export const INVITATION_BASIS = 'Invitation: asked once whether they want our news (POPIA s69(2))'

const CONSENT_WORDS: Record<string, string> = {
  'sign-up page': 'signed up on our news page',
  'opt-in link': 'pressed “Yes, keep me informed”',
  'imported with consent': 'said yes before they were imported',
  'recorded by staff': 'said yes to us (recorded by staff)',
}

/** The record of a subscriber's yes, in a sentence. */
export function consentBasis(s: Pick<NewsSubscriber, 'consentAt' | 'consentHow' | 'consentNote'>): string {
  const how = CONSENT_WORDS[s.consentHow ?? ''] ?? 'said yes'
  const note = (s.consentNote ?? '').trim()
  return `Consent: ${how} on ${DAY(s.consentAt ?? '')}${note ? ` (${note.slice(0, 200)})` : ''}`
}

/**
 * THE LIST, as a rule over the records. Each address once (the first record that names it wins: a company before
 * its contacts, clients before subscribers); an address that said stop is left out and counted; a subscriber with
 * no yes on record gets nothing but the one invitation.
 */
export function resolveAudience(input: AudienceInput): AudienceResult {
  const { audience, kind } = input
  const out: Recipient[] = []
  const excluded: Partial<Record<ExclusionReason, number>> = {}
  const seen = new Set<string>()
  const skip = (r: ExclusionReason) => { excluded[r] = (excluded[r] ?? 0) + 1 }
  const companyName = new Map(input.companies.map((c) => [c.id, c.name]))

  const clientEmails = new Set<string>()
  for (const c of input.companies) { const e = normaliseEmail(c.email); if (e) clientEmails.add(e) }
  for (const c of input.contacts) { const e = normaliseEmail(c.email); if (e) clientEmails.add(e) }

  const add = (raw: string | null | undefined, r: Omit<Recipient, 'email'>) => {
    const email = normaliseEmail(raw)
    if (!email) { skip('no address'); return }
    if (!isSendableEmail(email)) { skip('address does not look right'); return }
    if (seen.has(email)) { skip('on the list twice'); return }
    seen.add(email)
    const pref = input.preferences.get(email)
    if (pref) { skip(pref); return }
    out.push({ email, ...r })
  }

  const wantsClients = kind === 'news' && ['all_clients', 'clients_with_jobs', 'everyone'].includes(audience.kind)
  if (wantsClients) {
    const onlyJobs = audience.kind === 'clients_with_jobs'
    for (const c of input.companies) {
      if (onlyJobs && !input.clientsWithJobs.has(c.id)) continue
      add(c.email, { firstName: null, companyName: c.name, via: 'company', companyId: c.id, basis: CLIENT_BASIS, firstApproach: false })
    }
    for (const p of input.contacts) {
      /* A contact belongs to a client company, or is a private client in their own right. */
      if (onlyJobs && !input.clientsWithJobs.has(p.id) && !(p.companyId && input.clientsWithJobs.has(p.companyId))) continue
      add(p.email, {
        firstName: firstWord(p.firstName), companyName: p.companyId ? companyName.get(p.companyId) ?? null : null,
        via: 'contact', contactId: p.id, companyId: p.companyId ?? null, basis: CLIENT_BASIS, firstApproach: false,
      })
    }
  }

  const wantsSubscribers = audience.kind === 'subscribers' || audience.kind === 'everyone' || audience.kind === 'lists'
  if (wantsSubscribers) {
    const lists = audience.kind === 'lists' ? new Set(audience.listIds) : null
    for (const s of input.subscribers) {
      if (lists && !(s.listId && lists.has(s.listId))) continue
      const email = normaliseEmail(s.email)
      /* A client is a client: never asked, and sent news as one (on a client list, not this one). */
      if (clientEmails.has(email)) { skip('already a client'); continue }
      if (kind === 'invitation') {
        if (s.consentAt) { skip('already said yes'); continue }
        if (input.invitedSubscribers.has(s.id)) { skip('already invited once'); continue }
        add(email, { firstName: firstWord(s.name), companyName: s.company ?? null, via: 'subscriber', subscriberId: s.id, basis: INVITATION_BASIS, firstApproach: true })
      } else {
        if (!s.consentAt) { skip('no consent recorded'); continue }
        add(email, { firstName: firstWord(s.name), companyName: s.company ?? null, via: 'subscriber', subscriberId: s.id, basis: consentBasis(s), firstApproach: false })
      }
    }
  }
  return { recipients: out, excluded }
}

/**
 * THE LAST WORD AT THE MOMENT OF SENDING (Raptor's sendBlockReason). A subscriber's row goes only if their yes is
 * still on record -- or it is their one invitation and they have not already said yes. A client's row passes: the
 * unsubscribe check covers it.
 */
export function sendBlockReason(
  row: { subscriberId: string | null; firstApproach: boolean },
  subscriber: { consentAt: string | null } | null | undefined,
): string | null {
  if (!row.subscriberId) return null
  if (!subscriber) return 'They were taken off our list'
  if (row.firstApproach) return subscriber.consentAt ? 'Already said yes, so not asked again' : null
  return subscriber.consentAt ? null : 'No consent recorded, so never sent news'
}

/* ------------------------------------------------------------------------------------------------ the message */

export interface NewsPicture { url: string; caption?: string | null }

export interface CampaignContent {
  subject: string
  preheader: string
  body: string
  images?: NewsPicture[] | null
}

/** "Dear Sir/Madam" when a record has no first name: a newsletter is not a notice (Raptor). */
export const MERGE_FALLBACK = { first_name: 'there', company: 'your company' } as const
export const MERGE_FIELDS = ['first_name', 'company'] as const

export const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function mergeText(text: string, r: Pick<Recipient, 'firstName' | 'companyName'>): string {
  return text.replace(/\{\{\s*(first_name|company)\s*\}\}/g, (_, f: string) =>
    f === 'first_name' ? (r.firstName?.trim() || MERGE_FALLBACK.first_name) : (r.companyName?.trim() || MERGE_FALLBACK.company))
}

/** Merge fields the editor does not know, so the screen can say so before anybody sends them. */
export function unknownMergeFields(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    if (!(MERGE_FIELDS as readonly string[]).includes(m[1])) out.add(m[1])
  }
  return [...out]
}

/**
 * LINKS (Raptor's linkify), applied to ESCAPED text so a link cannot smuggle an attribute in; only http(s), so a
 * `javascript:` address stays words. `[words](https://...)` and a bare https:// address become links.
 */
export function linkify(escapedHtml: string, colour = '#454B50'): string {
  return escapedHtml.replace(
    /\[([^\]<>\n]+)\]\((https?:\/\/[^\s)<>"]+)\)|(https?:\/\/[^\s<>"]+)/g,
    (_m, label: string | undefined, href: string | undefined, bare: string | undefined) => {
      if (label && href) return `<a href="${href}" style="color:${colour}">${label}</a>`
      const url = bare ?? ''
      const trail = /[.,;:!?)]+$/.exec(url)?.[0] ?? ''
      const clean = url.slice(0, url.length - trail.length)
      return `<a href="${clean}" style="color:${colour}">${clean}</a>${trail}`
    },
  )
}

/** A blank line is a paragraph, a single line break stays one, **two asterisks** make bold. Nothing typed becomes markup. */
export function bodyHtml(text: string): string {
  return text.trim().split(/\n\s*\n/).filter((p) => p.trim()).map((p) =>
    `<p style="margin:0 0 14px">${linkify(escapeHtml(p.trim())).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`).join('')
}

/** The plain-text twin of a body: links written out, bold markers gone. */
function bodyText(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)').replace(/\*\*([^*\n]+)\*\*/g, '$1').trim()
}

/** Only pictures with an https address: an http one is refused by half the mail programs. */
export function cleanPictures(raw: unknown): NewsPicture[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p) => {
    const url = typeof p?.url === 'string' ? p.url.trim() : ''
    if (!/^https:\/\/[^\s"<>]+$/.test(url)) return []
    const caption = typeof p?.caption === 'string' ? p.caption.trim().slice(0, 300) : ''
    return [{ url, caption: caption || null }]
  }).slice(0, 12)
}

export interface RenderOptions {
  unsubscribeUrl: string
  companyName: string
  companyAddress?: string | null
  /** The company's own logo from Settings (quotes, PDFs and client emails keep it: CLAUDE.md). */
  logoUrl?: string | null
  /** Why they are getting it, in a sentence -- a client, somebody who said yes, somebody asked once. */
  basis: 'client' | 'subscriber' | 'invitation'
  /** The invitation's "Yes, keep me informed" button: a signed link to this person's own yes. */
  optInUrl?: string | null
}

/** The words on the invitation's button (Raptor's, the firm's own wording). */
export const OPT_IN_LABEL = 'Yes, keep me informed'

/* The email's colours: Remus's brand board (graphite, stone). An email is read in somebody else's mail program,
   where the app's skins do not reach, so these are written in, as every outgoing Remus email does. */
const INK = '#454B50'
const RULE = '#E5E1DA'
const MUTED = '#6B7075'

/**
 * ONE RECIPIENT'S EMAIL (Raptor's renderCampaignEmail). THE UNSUBSCRIBE LINK IS IN EVERY MESSAGE: POPIA s69(4)(b)
 * requires the sender's identity and a way to make it stop in each one, not in the first.
 */
export function renderNewsEmail(content: CampaignContent, recipient: Pick<Recipient, 'firstName' | 'companyName'>, opts: RenderOptions) {
  const subject = mergeText(content.subject, recipient).replace(/\s+/g, ' ').trim()
  const body = mergeText(content.body, recipient)
  const preheader = mergeText(content.preheader, recipient).trim()
  const pictures = cleanPictures(content.images)
  const company = opts.companyName.trim() || 'Urban Haus Construction'
  const logo = opts.logoUrl && /^https:\/\/[^\s"<>]+$/.test(opts.logoUrl.trim())
    ? `<p style="margin:0 0 20px"><img src="${escapeHtml(opts.logoUrl.trim())}" alt="${escapeHtml(company)}" style="max-height:56px;max-width:220px;height:auto;border:0"></p>`
    : `<p style="margin:0 0 20px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${MUTED}">${escapeHtml(company)}</p>`
  const pics = pictures.map((p) => [
    '<p style="margin:0 0 6px">',
    `<img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption ?? '')}" style="display:block;width:100%;max-width:608px;height:auto;border:0;border-radius:6px">`,
    '</p>',
    p.caption ? `<p style="margin:0 0 16px;font-size:12px;color:${MUTED}">${escapeHtml(p.caption)}</p>` : '<p style="margin:0 0 16px"></p>',
  ].join('')).join('')
  const why = opts.basis === 'client'
    ? `You are receiving this because you are a client of ${company}.`
    : opts.basis === 'invitation'
      ? `We are writing once to ask whether you would like to hear from ${company}. Unless you press “${OPT_IN_LABEL}”, this is the only email of this kind we will send you.`
      : `You are receiving this because you asked for news from ${company}.`
  const unsub = escapeHtml(opts.unsubscribeUrl)
  /* A TABLE, NOT A STYLED LINK ALONE (Raptor): Outlook draws neither padding nor a background on an <a>. */
  const button = opts.optInUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0"><tr><td style="background:${INK};border-radius:6px">`
      + `<a href="${escapeHtml(opts.optInUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:bold" data-opt-in="1">${escapeHtml(OPT_IN_LABEL)}</a>`
      + '</td></tr></table>'
    : ''
  const html = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">',
    preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` : '',
    `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:${INK};max-width:640px;margin:0 auto;padding:20px 16px">`,
    logo,
    pics,
    `<div>${bodyHtml(body)}</div>`,
    button,
    `<div style="margin-top:32px;padding-top:12px;border-top:1px solid ${RULE};font-size:12px;color:${MUTED};line-height:1.5">`,
    `${escapeHtml(company)}${opts.companyAddress ? `<br>${escapeHtml(opts.companyAddress).replace(/\n/g, '<br>')}` : ''}<br>`,
    `${escapeHtml(why)} Quotes, invoices and emails about your own job are not affected by unsubscribing.<br>`,
    `<a href="${unsub}" style="color:${MUTED}">Unsubscribe from our news</a>`,
    '</div></div></body></html>',
  ].join('')
  const text = [
    bodyText(body),
    ...pictures.map((p) => `[Photo${p.caption ? `: ${p.caption}` : ''}] ${p.url}`),
    ...(opts.optInUrl ? ['', `${OPT_IN_LABEL}: ${opts.optInUrl}`] : []),
    '', '--', company, ...(opts.companyAddress ? [opts.companyAddress] : []),
    why, `Unsubscribe from our news: ${opts.unsubscribeUrl}`,
  ].join('\n')
  return { subject, html, text }
}

/** The confirmation a sign-up on the public page sends: one button, and nothing more until it is pressed. */
export function confirmEmail(opts: { name: string | null; companyName: string; confirmUrl: string; unsubscribeUrl: string; logoUrl?: string | null }) {
  const first = firstWord(opts.name)
  const content = {
    subject: `Please confirm: news from ${opts.companyName}`,
    preheader: 'One press and you are on our list.',
    body: `Hello ${first ?? 'there'},\n\nSomebody (we hope you) asked for news from ${opts.companyName} at this address: the jobs we finish, and what we are working on.\n\nPress the button to confirm. If it was not you, ignore this email and you will not hear from us.`,
  }
  return renderNewsEmail(content, { firstName: first, companyName: null }, {
    unsubscribeUrl: opts.unsubscribeUrl, companyName: opts.companyName, logoUrl: opts.logoUrl, basis: 'invitation', optInUrl: opts.confirmUrl,
  })
}

/* ------------------------------------------------------------------------------------------------ the sender */

/**
 * WHAT URBAN HAUS MUST SET UP BEFORE ANYTHING SENDS, as the screen says it. Nothing pretends to send without it:
 * the server refuses, and the screen draws this.
 */
export const SENDER_SETUP_STEPS = [
  'Resend (resend.com) is the service that sends Remus’s company email. In Resend, open Domains and add urbanhausgroup.co.za if it is not there.',
  'Put the DNS records Resend shows (two or three TXT records and an MX record) at the place urbanhausgroup.co.za’s DNS is kept, and wait until Resend marks the domain Verified. Stephan is doing this now.',
  'On that domain in Resend, switch on open tracking and click tracking, so Remus can show what was opened.',
  'In Vercel, RESEND_API_KEY and EMAIL_FROM (for example Urban Haus <news@urbanhausgroup.co.za>) must be set. Optional: MARKETING_FROM, if news should go from a different address than quotes.',
  'For delivery results: in Resend add a webhook to https://<the site>/api/portal/news-resend-webhook for email.sent, email.delivered, email.delivery_delayed, email.bounced, email.complained, email.opened and email.clicked, and put its signing secret in Vercel as RESEND_WEBHOOK_SECRET.',
] as const

export type SenderChoice = { from: string } | { error: string }

/** The bare domain of "Name <a@b>" or "a@b", lower-cased. */
export function mailDomainOf(address: string | null | undefined): string {
  const raw = (address ?? '').trim()
  const inner = /<([^>]+)>\s*$/.exec(raw)?.[1] ?? raw
  return (inner.split('@')[1] ?? '').trim().toLowerCase().replace(/\.$/, '')
}

/** News goes from MARKETING_FROM if set, else the company sender (EMAIL_FROM), as quotes do. */
export function newsSender(env: Record<string, string | undefined>): SenderChoice {
  const from = (env.MARKETING_FROM || env.EMAIL_FROM || '').trim()
  if (!from) return { error: 'EMAIL_FROM is not set in Vercel, so there is no address to send news from.' }
  if (!mailDomainOf(from).includes('.')) return { error: `The sending address (${from}) is not an email address.` }
  return { from }
}

/**
 * RESEND'S REFUSALS, IN PLAIN WORDS. The one that matters this week: the urbanhausgroup.co.za domain is not yet
 * verified at Resend (Stephan is adding the DNS records), and Resend answers 403 "The ... domain is not verified".
 * The owner is not a developer: the screen says what is happening and that nothing went.
 */
export function plainResendError(status: number, message: string, domain: string): string {
  const m = message || ''
  if (/not verified|verify your domain|domain.*(pending|not found)|only send testing emails/i.test(m) || (status === 403 && !/api key/i.test(m))) {
    return `Newsletters cannot go out yet: ${domain || 'our email domain'} is still waiting to be verified at Resend, the service that sends Remus’s email. Once the DNS records are in and Resend shows the domain as Verified, sending works. Nothing was sent.`
  }
  if (status === 401 || /api key/i.test(m)) return 'Resend did not accept Remus’s key (RESEND_API_KEY in Vercel). Nothing was sent.'
  if (status === 429) return 'Resend asked us to slow down. The rest goes on the next pass.'
  if (status === 0) return `Resend could not be reached just now: ${m}`
  return `Resend could not take the emails just now (${status}): ${m}`
}

/** Refusals that will not get better by trying again in a minute: the key or the domain. */
export function isSetupRefusal(status: number, message: string): boolean {
  return status === 401 || status === 403 || /not verified|verify your domain|api key/i.test(message)
}

/* ------------------------------------------------------------------------------------------------ imported lists */

export type ImportOutcome = 'new' | 'already on our list' | 'already a client' | 'bad email' | 'duplicate in file'
export const IMPORT_OUTCOMES: ImportOutcome[] = ['new', 'already on our list', 'already a client', 'bad email', 'duplicate in file']

export interface ImportRow { email: string; name: string; company: string; phone: string }

/** A CSV file read into rows of cells: quotes, doubled quotes, commas or semicolons (Excel in South Africa uses either). */
export function readCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1 }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim()))
}

/** The rows of a list, found by their headings: an Email column, and name, company and phone if there. */
export function readSubscriberSheet(table: string[][]): { rows: ImportRow[]; problem: string | null } {
  if (!table.length) return { rows: [], problem: 'The file is empty.' }
  const head = table[0].map((h) => h.trim().toLowerCase())
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h))
  const email = col('email', 'e-mail', 'email address', 'e-mail address', 'mail')
  if (email < 0) return { rows: [], problem: 'The first row must be headings, with one called Email.' }
  const name = col('name', 'full name', 'client', 'client name', 'contact')
  const first = col('first name', 'firstname', 'name (first)')
  const last = col('last name', 'surname', 'lastname')
  const company = col('company', 'company name', 'business', 'organisation', 'organization')
  const phone = col('phone', 'mobile', 'cell', 'cellphone', 'telephone', 'tel')
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
  const rows = table.slice(1).map((r) => ({
    email: at(r, email),
    name: at(r, name) || [at(r, first), at(r, last)].filter(Boolean).join(' '),
    company: at(r, company),
    phone: at(r, phone),
  })).filter((r) => r.email || r.name)
  if (rows.length > 5000) return { rows: [], problem: 'That list has more than 5 000 rows. Split it into smaller files.' }
  return { rows, problem: null }
}

export interface ImportPlan {
  outcomes: { row: ImportRow; outcome: ImportOutcome }[]
  counts: Record<ImportOutcome, number>
  examples: Record<ImportOutcome, string[]>
}

/** What a list would add, before anything is written: the preview and the write use this one plan (Raptor). */
export function planImport(rows: ImportRow[], known: { clients: Set<string>; subscribers: Set<string> }): ImportPlan {
  const counts = Object.fromEntries(IMPORT_OUTCOMES.map((o) => [o, 0])) as Record<ImportOutcome, number>
  const examples = Object.fromEntries(IMPORT_OUTCOMES.map((o) => [o, [] as string[]])) as Record<ImportOutcome, string[]>
  const seen = new Set<string>()
  const outcomes = rows.map((row) => {
    const email = normaliseEmail(row.email)
    const outcome: ImportOutcome = !email || !isSendableEmail(email) ? 'bad email'
      : seen.has(email) ? 'duplicate in file'
        : known.clients.has(email) ? 'already a client'
          : known.subscribers.has(email) ? 'already on our list' : 'new'
    if (email) seen.add(email)
    counts[outcome] += 1
    if (examples[outcome].length < 5) examples[outcome].push(row.email || row.name || '(empty row)')
    return { row: { ...row, email }, outcome }
  })
  return { outcomes, counts, examples }
}

/* ------------------------------------------------------------------------------------------------ Resend's webhook */

type ResendEvent = {
  type?: string
  created_at?: string
  data?: { email_id?: string; created_at?: string; to?: string[] | string; bounce?: { type?: string; message?: string }; click?: { link?: string; timestamp?: string } }
}
export type { ResendEvent }

export const DELIVERY_EVENTS = [
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.opened', 'email.clicked',
] as const

/** What an event means for the send and for the address (Raptor's bounceOutcome). */
export function bounceOutcome(event: ResendEvent)
  : { state: 'bounced' | 'complained'; preference: 'undeliverable' | 'unsubscribed' | null; note: string } | null {
  if (event.type === 'email.complained') return { state: 'complained', preference: 'unsubscribed', note: 'Reported as spam' }
  if (event.type === 'email.bounced') {
    const kind = (event.data?.bounce?.type ?? '').toLowerCase()
    /* A soft bounce (a full mailbox) is recorded on the send and the address left alone; only a permanent one stops
       the news. An unlabelled bounce counts as hard: Resend suppresses it anyway. */
    const hard = !kind || kind === 'permanent' || kind === 'hard'
    return {
      state: 'bounced', preference: hard ? 'undeliverable' : null,
      note: `${hard ? 'Hard bounce' : 'Soft bounce'}${event.data?.bounce?.message ? `: ${event.data.bounce.message}` : ''}`.slice(0, 500),
    }
  }
  return null
}

/** One delivery, read: which send, what happened, when, and the key that makes a retry harmless. */
export function deliveryEvent(event: ResendEvent, svixId: string | null | undefined) {
  const type = event.type ?? ''
  if (!(DELIVERY_EVENTS as readonly string[]).includes(type)) return null
  const resendId = event.data?.email_id ?? ''
  if (!resendId) return null
  const at = event.data?.click?.timestamp ?? event.created_at ?? event.data?.created_at ?? null
  const eventId = svixId?.trim() || `${type}:${resendId}:${at ?? ''}`
  const link = event.data?.click?.link ?? ''
  const bounce = bounceOutcome(event)
  return {
    eventId, resendId, type, at,
    note: bounce?.note ?? (type === 'email.delivery_delayed' ? 'Delivery delayed; Resend is still trying' : null),
    /* The way out is not interest: a click on the unsubscribe link is not a click. */
    countClick: !/\/unsubscribe\/|news-unsubscribe/.test(link),
  }
}

/** Verified the way Resend signs (Svix): HMAC-SHA256 over "<id>.<timestamp>.<body>", five minutes' leeway. */
export function verifySvix(secret: string, id: string, timestamp: string, signatures: string, body: string, nowMs: number): boolean {
  if (!id || !timestamp || !signatures) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  return signatures.split(' ').some((part) => {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) return false
    const given = Buffer.from(sig, 'base64')
    return given.length === expected.length && crypto.timingSafeEqual(given, expected)
  })
}

/** Enough of the address for the person to recognise it, not enough to harvest from a forwarded link. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}`
}

/* ------------------------------------------------------------------------------------------------ Resend's limits */

/** The batch endpoint takes a hundred emails a call, two calls a second by default (Raptor). */
export const RESEND_BATCH_MAX = 100
export const RESEND_MIN_GAP_MS = 600
export const MAX_ATTEMPTS = 3
