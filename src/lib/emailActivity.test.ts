import { describe, expect, it } from 'vitest'
import { parseEmailActivity, replySubject } from './emailActivity'

describe('parseEmailActivity', () => {
  it('reads the direction and real subject back out of a logged email', () => {
    expect(parseEmailActivity('Email sent: Quote Q-0012')).toEqual({ direction: 'sent', isSpam: false, subject: 'Quote Q-0012' })
    expect(parseEmailActivity('Email received: Re: Quote Q-0012')).toEqual({ direction: 'received', isSpam: false, subject: 'Re: Quote Q-0012' })
    expect(parseEmailActivity('Email received (was in Spam/Junk): Drawings')).toEqual({ direction: 'received', isSpam: true, subject: 'Drawings' })
  })

  it('returns null for anything not logged in that convention', () => {
    expect(parseEmailActivity('Site visit')).toBeNull()
  })
})

describe('replySubject', () => {
  it('adds Re: once', () => {
    expect(replySubject('Quote Q-0012')).toBe('Re: Quote Q-0012')
    expect(replySubject('RE: Quote Q-0012')).toBe('RE: Quote Q-0012')
  })
})
