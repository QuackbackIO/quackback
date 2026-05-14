import { describe, it, expect } from 'vitest'
import { normalizeDomain, emailDomain } from '../normalize-domain'

describe('normalizeDomain', () => {
  it('lowercases ASCII input', () => {
    expect(normalizeDomain('ACME.COM')).toBe('acme.com')
  })

  it('strips a trailing dot', () => {
    expect(normalizeDomain('acme.com.')).toBe('acme.com')
  })

  it('trims leading/trailing whitespace', () => {
    expect(normalizeDomain('  acme.com  ')).toBe('acme.com')
  })

  it('punycodes IDN labels', () => {
    // Müller → xn--mller-kva (per IDNA)
    expect(normalizeDomain('Bücher.example.org')).toContain('xn--')
    expect(normalizeDomain('Bücher.example.org')).toMatch(/^xn--/)
  })

  it.each([['localhost'], ['my-machine'], ['acme']])(
    'rejects single-label hostname %s',
    (input) => {
      expect(normalizeDomain(input)).toBeNull()
    }
  )

  it.each([['127.0.0.1'], ['10.0.0.1'], ['192.168.1.1'], ['255.255.255.255']])(
    'rejects IPv4 literal %s',
    (input) => {
      expect(normalizeDomain(input)).toBeNull()
    }
  )

  it.each([['fe80::1'], ['::1'], ['2001:db8::1']])('rejects IPv6 literal %s', (input) => {
    expect(normalizeDomain(input)).toBeNull()
  })

  it.each([['site.test'], ['acme.example'], ['foo.invalid'], ['acme.localhost']])(
    'rejects RFC 6761 reserved suffix %s',
    (input) => {
      expect(normalizeDomain(input)).toBeNull()
    }
  )

  it('rejects empty/null/undefined', () => {
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain(null)).toBeNull()
    expect(normalizeDomain(undefined)).toBeNull()
    expect(normalizeDomain('   ')).toBeNull()
  })

  it('accepts a valid public FQDN', () => {
    expect(normalizeDomain('acme.com')).toBe('acme.com')
    expect(normalizeDomain('mail.acme.co.uk')).toBe('mail.acme.co.uk')
  })
})

describe('emailDomain', () => {
  it('extracts and lowercases', () => {
    expect(emailDomain('FOO@Acme.COM')).toBe('acme.com')
  })

  it('handles sub-addressed local parts', () => {
    expect(emailDomain('foo+tag@acme.com')).toBe('acme.com')
  })

  it('strips trailing dot from domain', () => {
    expect(emailDomain('foo@acme.com.')).toBe('acme.com')
  })

  it('returns null for malformed inputs', () => {
    expect(emailDomain('')).toBeNull()
    expect(emailDomain('no-at-sign')).toBeNull()
    expect(emailDomain('@acme.com')).toBeNull()
    expect(emailDomain('foo@')).toBeNull()
  })

  it('returns null when domain part is invalid', () => {
    expect(emailDomain('foo@localhost')).toBeNull()
    expect(emailDomain('foo@127.0.0.1')).toBeNull()
    expect(emailDomain('foo@bar.test')).toBeNull()
  })
})
