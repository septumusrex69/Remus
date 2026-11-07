import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CLIENT_BASIS, INVITATION_BASIS, bodyHtml, bounceOutcome, cleanPictures, consentBasis, deliveryEvent, isSendableEmail,
  isSetupRefusal, maskEmail, newsSender, parseAudience, planImport, plainResendError, readCsv, readSubscriberSheet,
  renderNewsEmail, resolveAudience, sendBlockReason, unknownMergeFields, verifySvix, type AudienceInput,
} from './newsRules.js'

/* Remus · Handover 8: the News rules (POPIA s69 as Raptor reads it), held without a database. */

const base = (over: Partial<AudienceInput> = {}): AudienceInput => ({
  audience: { kind: 'all_clients' },
  kind: 'news',
  companies: [
    { id: 'c1', name: 'Brooklyn Homes', email: 'Info@Brooklyn.test ' },
    { id: 'c2', name: 'No Mail (Pty) Ltd', email: null },
  ],
  contacts: [
    { id: 'p1', firstName: 'Thandi Grace', email: 'thandi@example.test', companyId: 'c1' },
    { id: 'p2', firstName: 'Piet', email: 'info@brooklyn.test', companyId: 'c1' },
    { id: 'p3', firstName: 'Sipho', email: 'sipho@private.test', companyId: null },
    { id: 'p4', firstName: 'Typo', email: 'typo@', companyId: null },
  ],
  subscribers: [
    { id: 's1', email: 'yes@sub.test', name: 'Anna Yes', consentAt: '2026-11-03T10:00:00Z', consentHow: 'sign-up page' },
    { id: 's2', email: 'never@sub.test', name: 'Ben Never', consentAt: null, listId: 'L1' },
    { id: 's3', email: 'thandi@example.test', name: 'Thandi', consentAt: null, listId: 'L1' },
    { id: 's4', email: 'asked@sub.test', name: 'Asked Once', consentAt: null, listId: 'L1' },
  ],
  clientsWithJobs: new Set(['p3']),
  preferences: new Map([['sipho@private.test', 'unsubscribed']]),
  invitedSubscribers: new Set(['s4']),
  ...over,
})

describe('who a newsletter goes to', () => {
  it('sends to every client address once, never to somebody who said stop', () => {
    const r = resolveAudience(base())
    expect(r.recipients.map((x) => x.email)).toEqual(['info@brooklyn.test', 'thandi@example.test'])
    expect(r.recipients.every((x) => x.basis === CLIENT_BASIS)).toBe(true)
    expect(r.excluded).toEqual({ 'no address': 1, 'on the list twice': 1, unsubscribed: 1, 'address does not look right': 1 })
  })

  it('a contact carries their client company name and first name for the merge', () => {
    const thandi = resolveAudience(base()).recipients.find((x) => x.email === 'thandi@example.test')
    expect(thandi).toMatchObject({ firstName: 'Thandi', companyName: 'Brooklyn Homes', via: 'contact' })
  })

  it('"clients we have done a job for" keeps only clients with a project', () => {
    const r = resolveAudience(base({ audience: { kind: 'clients_with_jobs' }, preferences: new Map() }))
    expect(r.recipients.map((x) => x.email)).toEqual(['sipho@private.test'])
  })

  it('a subscriber gets news only with a yes on record, and the record says when and how', () => {
    const r = resolveAudience(base({ audience: { kind: 'subscribers' } }))
    expect(r.recipients.map((x) => x.email)).toEqual(['yes@sub.test'])
    expect(r.recipients[0].basis).toMatch(/signed up on our news page on 3 November 2026/)
    expect(r.excluded['no consent recorded']).toBe(2)
    expect(r.excluded['already a client']).toBe(1)
  })

  it('"everyone" is clients and consenting subscribers, each address once', () => {
    const r = resolveAudience(base({ audience: { kind: 'everyone' } }))
    expect(r.recipients.map((x) => x.email)).toEqual(['info@brooklyn.test', 'thandi@example.test', 'yes@sub.test'])
  })

  it('an invitation goes once, only to people on the list who never said yes and were never asked', () => {
    const r = resolveAudience(base({ kind: 'invitation', audience: { kind: 'lists', listIds: ['L1'] } }))
    expect(r.recipients.map((x) => x.email)).toEqual(['never@sub.test'])
    expect(r.recipients[0]).toMatchObject({ firstApproach: true, basis: INVITATION_BASIS })
    expect(r.excluded['already invited once']).toBe(1)
    expect(r.excluded['already a client']).toBe(1)
  })

  it('an invitation never goes to clients, even on a client list', () => {
    const r = resolveAudience(base({ kind: 'invitation', audience: { kind: 'all_clients' } }))
    expect(r.recipients).toEqual([])
  })

  it('at the moment of sending: no yes, no news; one invitation, not after a yes', () => {
    expect(sendBlockReason({ subscriberId: null, firstApproach: false }, null)).toBeNull()
    expect(sendBlockReason({ subscriberId: 's', firstApproach: false }, { consentAt: null })).toMatch(/No consent/)
    expect(sendBlockReason({ subscriberId: 's', firstApproach: false }, { consentAt: '2026-11-01' })).toBeNull()
    expect(sendBlockReason({ subscriberId: 's', firstApproach: true }, { consentAt: null })).toBeNull()
    expect(sendBlockReason({ subscriberId: 's', firstApproach: true }, { consentAt: '2026-11-01' })).toMatch(/Already said yes/)
    expect(sendBlockReason({ subscriberId: 's', firstApproach: false }, null)).toMatch(/taken off/)
  })

  it('reads a stored audience safely', () => {
    expect(parseAudience({ kind: 'lists', listIds: ['a', 3] })).toEqual({ kind: 'lists', listIds: ['a'] })
    expect(parseAudience({ kind: 'all_leads' })).toBeNull()
    expect(parseAudience(null)).toBeNull()
  })

  it('consent in words, with where it was given', () => {
    expect(consentBasis({ consentAt: '2026-03-02T09:00:00Z', consentHow: 'imported with consent', consentNote: 'Home show stand' }))
      .toBe('Consent: said yes before they were imported on 2 March 2026 (Home show stand)')
  })
})

describe('the email', () => {
  const opts = { unsubscribeUrl: 'https://remus.test/unsubscribe/abc', companyName: 'Urban Haus Construction', basis: 'client' as const }

  it('every email carries the unsubscribe link and says why they get it', () => {
    const r = renderNewsEmail({ subject: 'Done in {{company}}', preheader: '', body: 'Dear {{first_name}},\n\nWe finished.' }, { firstName: 'Thandi', companyName: 'Brooklyn' }, opts)
    expect(r.subject).toBe('Done in Brooklyn')
    expect(r.html).toContain('href="https://remus.test/unsubscribe/abc"')
    expect(r.html).toContain('client of Urban Haus Construction')
    expect(r.text).toContain('Unsubscribe from our news: https://remus.test/unsubscribe/abc')
    expect(r.html).toContain('Dear Thandi,')
  })

  it('a missing name has a polite stand-in', () => {
    const r = renderNewsEmail({ subject: 'x', preheader: '', body: 'Hello {{first_name}}' }, { firstName: null, companyName: null }, opts)
    expect(r.text).toContain('Hello there')
  })

  it('nothing typed becomes markup; links and bold do', () => {
    const h = bodyHtml('<script>x</script> **big** [site](https://urbanhausgroup.co.za) javascript:alert(1)')
    expect(h).not.toContain('<script>')
    expect(h).toContain('<strong>big</strong>')
    expect(h).toContain('href="https://urbanhausgroup.co.za"')
    expect(h).not.toContain('href="javascript')
  })

  it('photos: only https, with captions', () => {
    expect(cleanPictures([{ url: 'http://x.test/a.jpg' }, { url: 'https://x.test/b.jpg', caption: ' Kitchen ' }, 'junk']))
      .toEqual([{ url: 'https://x.test/b.jpg', caption: 'Kitchen' }])
    const r = renderNewsEmail({ subject: 's', preheader: '', body: 'b', images: [{ url: 'https://x.test/b.jpg', caption: 'Brooklyn kitchen' }] }, { firstName: null, companyName: null }, opts)
    expect(r.html).toContain('src="https://x.test/b.jpg"')
    expect(r.html).toContain('Brooklyn kitchen')
  })

  it('the invitation has the button and says it asks once', () => {
    const r = renderNewsEmail({ subject: 's', preheader: '', body: 'b' }, { firstName: null, companyName: null }, { ...opts, basis: 'invitation', optInUrl: 'https://remus.test/opt-in/t' })
    expect(r.html).toContain('data-opt-in="1"')
    expect(r.html).toContain('only email of this kind')
  })

  it('unknown merge fields are named before sending', () => {
    expect(unknownMergeFields('{{first_name}} {{suburb}} {{ company }}')).toEqual(['suburb'])
  })
})

describe('the sender and Resend', () => {
  it('news goes from MARKETING_FROM, else EMAIL_FROM', () => {
    expect(newsSender({ EMAIL_FROM: 'Urban Haus <news@urbanhausgroup.co.za>' })).toEqual({ from: 'Urban Haus <news@urbanhausgroup.co.za>' })
    expect(newsSender({ EMAIL_FROM: 'a@b.co', MARKETING_FROM: 'News <n@c.co>' })).toEqual({ from: 'News <n@c.co>' })
    expect('error' in newsSender({})).toBe(true)
  })

  it('the domain not verified yet is said in plain words, and nothing retries it', () => {
    const msg = 'The urbanhausgroup.co.za domain is not verified. Please, add and verify your domain on https://resend.com/domains'
    expect(plainResendError(403, msg, 'urbanhausgroup.co.za')).toMatch(/urbanhausgroup\.co\.za is still waiting to be verified.*Nothing was sent/)
    expect(isSetupRefusal(403, msg)).toBe(true)
    expect(isSetupRefusal(429, 'slow down')).toBe(false)
    expect(plainResendError(401, 'API key is invalid', 'x')).toMatch(/key/)
  })

  it('reads a delivery and its bounce', () => {
    expect(bounceOutcome({ type: 'email.bounced', data: { bounce: { type: 'Permanent', message: 'No such user' } } }))
      .toEqual({ state: 'bounced', preference: 'undeliverable', note: 'Hard bounce: No such user' })
    expect(bounceOutcome({ type: 'email.bounced', data: { bounce: { type: 'Transient' } } })?.preference).toBeNull()
    expect(bounceOutcome({ type: 'email.complained' })?.preference).toBe('unsubscribed')
    const e = deliveryEvent({ type: 'email.clicked', data: { email_id: 'r1', click: { link: 'https://x/unsubscribe/abc', timestamp: 't' } } }, 'svix-1')
    expect(e).toMatchObject({ eventId: 'svix-1', resendId: 'r1', countClick: false })
    expect(deliveryEvent({ type: 'domain.updated' }, 'x')).toBeNull()
  })

  it('accepts only Resend’s signature, and only fresh', () => {
    const secret = `whsec_${Buffer.from('a-secret-of-some-length').toString('base64')}`
    const now = 1_800_000_000_000
    const ts = String(now / 1000)
    const sig = crypto.createHmac('sha256', Buffer.from('a-secret-of-some-length')).update(`id1.${ts}.{"a":1}`).digest('base64')
    expect(verifySvix(secret, 'id1', ts, `v1,${sig}`, '{"a":1}', now)).toBe(true)
    expect(verifySvix(secret, 'id1', ts, `v1,${sig}`, '{"a":2}', now)).toBe(false)
    expect(verifySvix(secret, 'id1', ts, `v1,${sig}`, '{"a":1}', now + 600_000)).toBe(false)
  })
})

describe('an imported list', () => {
  it('reads a CSV with quotes and semicolons, finds the columns by heading', () => {
    const t = readCsv('﻿First name;Surname;E-mail;Company\n"Anna";"de Wet";anna@x.test;"Brooklyn; Homes"\r\n;;;\n')
    expect(t).toEqual([['First name', 'Surname', 'E-mail', 'Company'], ['Anna', 'de Wet', 'anna@x.test', 'Brooklyn; Homes']])
    expect(readSubscriberSheet(t).rows).toEqual([{ email: 'anna@x.test', name: 'Anna de Wet', company: 'Brooklyn; Homes', phone: '' }])
    expect(readSubscriberSheet([['Name', 'Phone']]).problem).toMatch(/Email/)
  })

  it('counts what it would add before anything is written', () => {
    const rows = ['new@x.test', 'NEW@x.test', 'client@x.test', 'sub@x.test', 'bad@'].map((email) => ({ email, name: '', company: '', phone: '' }))
    const plan = planImport(rows, { clients: new Set(['client@x.test']), subscribers: new Set(['sub@x.test']) })
    expect(plan.counts).toEqual({ new: 1, 'already on our list': 1, 'already a client': 1, 'bad email': 1, 'duplicate in file': 1 })
  })
})

it('small things', () => {
  expect(isSendableEmail('a@b.co')).toBe(true)
  expect(isSendableEmail('a@b')).toBe(false)
  expect(maskEmail('thandi@example.test')).toBe('th••••@example.test')
})
