import { describe, it, expect } from 'vitest'
import { normalizeEmail, normalizeDomain, parseDomainFromEmail } from '../normalize'

const at = '@'
const mk = (local: string, domain: string) => `${local}${at}${domain}`

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  ' + mk('Foo', 'Acme.COM') + '  ')).toBe(mk('foo', 'acme.com'))
  })
  it('returns null for empty/null', () => {
    expect(normalizeEmail('')).toBe(null)
    expect(normalizeEmail(null)).toBe(null)
    expect(normalizeEmail(undefined)).toBe(null)
  })
  it('strips mailto: prefix', () => {
    expect(normalizeEmail('MAILTO:' + mk('a', 'b.com'))).toBe(mk('a', 'b.com'))
  })
  it('strips angle brackets', () => {
    expect(normalizeEmail('<' + mk('a', 'b.com') + '>')).toBe(mk('a', 'b.com'))
  })
  it('preserves plus-aliases (does not strip identity)', () => {
    expect(normalizeEmail(mk('user+work', 'acme.com'))).toBe(mk('user+work', 'acme.com'))
  })
  it('rejects malformed addresses', () => {
    expect(normalizeEmail('not-an-email')).toBe(null)
    expect(normalizeEmail(at + 'nodomain.com')).toBe(null)
    expect(normalizeEmail('local' + at)).toBe(null)
    expect(normalizeEmail(mk('local', 'nope'))).toBe(null)
  })
})

describe('normalizeDomain', () => {
  it('lowercases bare domains', () => {
    expect(normalizeDomain('ACME.COM')).toBe('acme.com')
  })
  it('strips protocol, path, query, port', () => {
    expect(normalizeDomain('https://acme.com/foo?bar=1')).toBe('acme.com')
    expect(normalizeDomain('http://acme.com:8080')).toBe('acme.com')
  })
  it('strips leading and trailing dots', () => {
    expect(normalizeDomain('.acme.com.')).toBe('acme.com')
    expect(normalizeDomain('acme.com..')).toBe('acme.com')
  })
  it('rejects bare hostnames without a dot', () => {
    expect(normalizeDomain('localhost')).toBe(null)
  })
  it('rejects empty/invalid characters', () => {
    expect(normalizeDomain('')).toBe(null)
    expect(normalizeDomain(null)).toBe(null)
    expect(normalizeDomain('not a domain')).toBe(null)
    expect(normalizeDomain('weird' + at + 'chars.com')).toBe(null)
  })
})

describe('parseDomainFromEmail', () => {
  it('returns the domain portion lowercased', () => {
    expect(parseDomainFromEmail(mk('Foo', 'Acme.COM'))).toBe('acme.com')
  })
  it('returns null when the email is invalid', () => {
    expect(parseDomainFromEmail('garbage')).toBe(null)
    expect(parseDomainFromEmail(null)).toBe(null)
  })
  it('handles plus-aliases without affecting domain extraction', () => {
    expect(parseDomainFromEmail(mk('user+work', 'acme.com'))).toBe('acme.com')
  })
})
