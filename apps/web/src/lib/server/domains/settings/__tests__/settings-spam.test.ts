/**
 * Trusted-sender matching for the inbound spam filter: exact addresses and
 * bare/`@`-prefixed domains, case-insensitive, with null/empty inputs never
 * matching. Pure unit test.
 */
import { describe, it, expect } from 'vitest'
import { isTrustedSender, parseSpamFilterConfig } from '../settings.spam'

describe('isTrustedSender', () => {
  it('matches an exact address, case-insensitively', () => {
    expect(isTrustedSender('jane@acme.com', ['jane@acme.com'])).toBe(true)
    expect(isTrustedSender('Jane@Acme.COM', ['jane@acme.com'])).toBe(true)
    expect(isTrustedSender('jane@acme.com', ['JANE@ACME.COM'])).toBe(true)
  })

  it('matches a bare or @-prefixed domain against the sender domain', () => {
    expect(isTrustedSender('anyone@acme.com', ['acme.com'])).toBe(true)
    expect(isTrustedSender('anyone@acme.com', ['@acme.com'])).toBe(true)
    expect(isTrustedSender('anyone@ACME.com', ['acme.com'])).toBe(true)
  })

  it('does not match a different address or a mere suffix domain', () => {
    expect(isTrustedSender('jane@other.com', ['jane@acme.com'])).toBe(false)
    // Suffix safety: "acme.com" must not trust "evilacme.com".
    expect(isTrustedSender('jane@evilacme.com', ['acme.com'])).toBe(false)
    // Subdomains are not implied by a parent-domain entry.
    expect(isTrustedSender('jane@sub.acme.com', ['acme.com'])).toBe(false)
  })

  it('never matches a null/empty sender or an empty list', () => {
    expect(isTrustedSender(null, ['acme.com'])).toBe(false)
    expect(isTrustedSender('', ['acme.com'])).toBe(false)
    expect(isTrustedSender('jane@acme.com', [])).toBe(false)
  })
})

describe('parseSpamFilterConfig', () => {
  it('defaults to an empty trusted-sender list', () => {
    expect(parseSpamFilterConfig(null)).toEqual({ trustedSenders: [] })
    expect(parseSpamFilterConfig('not json')).toEqual({ trustedSenders: [] })
    expect(parseSpamFilterConfig('{}')).toEqual({ trustedSenders: [] })
  })

  it('keeps only plausible string entries, normalized', () => {
    expect(
      parseSpamFilterConfig(
        JSON.stringify({ trustedSenders: [' Jane@ACME.com ', '', 42, 'acme.com', null] })
      )
    ).toEqual({ trustedSenders: ['jane@acme.com', 'acme.com'] })
  })
})
