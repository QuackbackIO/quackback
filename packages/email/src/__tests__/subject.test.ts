import { describe, expect, it } from 'vitest'
import { MAX_SUBJECT_LENGTH, singleLineSubject } from '../subject'
import { conversationReplySubject, teamAlertSubject } from '../conversation-copy'

describe('singleLineSubject', () => {
  it('leaves an ordinary subject exactly as it is', () => {
    expect(singleLineSubject('Billing overcharge')).toBe('Billing overcharge')
    expect(singleLineSubject('Re: Ünïcødé façade 🚀')).toBe('Re: Ünïcødé façade 🚀')
  })

  it('turns line breaks, tabs and blank lines into single spaces', () => {
    expect(singleLineSubject('My order\r\n\r\n\thas not arrived\n')).toBe(
      'My order has not arrived'
    )
    expect(singleLineSubject('one\rtwo\nthree\u2028four\u2029five')).toBe('one two three four five')
  })

  it('removes other control characters', () => {
    expect(singleLineSubject('null\u0000 bell\u0007 del\u007f next\u0085 end')).toBe(
      'null bell del next end'
    )
  })

  it('collapses runs of whitespace and trims', () => {
    expect(singleLineSubject('   spaced     out   ')).toBe('spaced out')
  })

  it('caps a very long subject without splitting a character', () => {
    const capped = singleLineSubject('🚀'.repeat(MAX_SUBJECT_LENGTH + 50))
    expect(Array.from(capped)).toHaveLength(MAX_SUBJECT_LENGTH)
    expect(capped.endsWith('...')).toBe(true)
    expect(capped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  it('keeps a subject at the cap whole', () => {
    const exact = 'a'.repeat(MAX_SUBJECT_LENGTH)
    expect(singleLineSubject(exact)).toBe(exact)
  })
})

describe('conversationReplySubject on a subject taken from a multi-line message', () => {
  it('is a single line', () => {
    expect(conversationReplySubject('My order\r\n\r\n\thas not arrived\n')).toBe(
      'Re: My order has not arrived'
    )
  })

  it('still strips a Re: that sits behind a line break', () => {
    expect(conversationReplySubject('\nRe:\nInvoice')).toBe('Re: Invoice')
    expect(conversationReplySubject('re:\t\tre:\r\nInvoice')).toBe('Re: Invoice')
  })

  it('returns null when only whitespace and control characters remain', () => {
    expect(conversationReplySubject('\r\n\t\u0000')).toBeNull()
    expect(conversationReplySubject('Re:\r\n')).toBeNull()
  })

  it('caps a very long subject', () => {
    const subject = conversationReplySubject('x'.repeat(5000))!
    expect(subject.startsWith('Re: x')).toBe(true)
    expect(subject.length).toBeLessThanOrEqual(MAX_SUBJECT_LENGTH)
  })
})

describe('teamAlertSubject on a multi-line subject', () => {
  it('is a single line', () => {
    expect(teamAlertSubject('Wanda', 'My order\nhas not arrived')).toBe(
      'Wanda: My order has not arrived'
    )
  })
})
