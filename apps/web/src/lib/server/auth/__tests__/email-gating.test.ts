import { describe, it, expect } from 'vitest'
import { isEmailAtVerifiedDomain } from '../auth-restrictions'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'

const verifiedDomain = (name: string, overrides: Partial<VerifiedDomain> = {}): VerifiedDomain => ({
  id: 'domain_test' as `domain_${string}`,
  name,
  verificationToken: 'tok',
  verifiedAt: '2026-05-10T00:00:00.000Z',
  enforced: false,
  createdAt: '2026-05-10T00:00:00.000Z',
  ...overrides,
})

const pendingDomain = (name: string): VerifiedDomain => verifiedDomain(name, { verifiedAt: null })

describe('isEmailAtVerifiedDomain', () => {
  it('returns false when the verifiedDomains array is undefined', () => {
    expect(isEmailAtVerifiedDomain('foo@acme.com', undefined)).toBe(false)
  })

  it('returns false when the verifiedDomains array is empty', () => {
    expect(isEmailAtVerifiedDomain('foo@acme.com', [])).toBe(false)
  })

  it('returns false when only a pending row matches (verifiedAt null)', () => {
    expect(isEmailAtVerifiedDomain('foo@acme.com', [pendingDomain('acme.com')])).toBe(false)
  })

  it('matches a verified row (lowercase)', () => {
    expect(isEmailAtVerifiedDomain('foo@acme.com', [verifiedDomain('acme.com')])).toBe(true)
  })

  it('matches a verified row case-insensitively', () => {
    expect(isEmailAtVerifiedDomain('FOO@Acme.COM', [verifiedDomain('acme.com')])).toBe(true)
  })

  it('matches sub-addressed emails', () => {
    expect(isEmailAtVerifiedDomain('foo+tag@acme.com', [verifiedDomain('acme.com')])).toBe(true)
  })

  it('matches an email with trailing dot in the domain', () => {
    expect(isEmailAtVerifiedDomain('foo@acme.com.', [verifiedDomain('acme.com')])).toBe(true)
  })

  it('does NOT match a subdomain', () => {
    expect(isEmailAtVerifiedDomain('foo@bar.acme.com', [verifiedDomain('acme.com')])).toBe(false)
  })

  it('does NOT match a different domain', () => {
    expect(isEmailAtVerifiedDomain('foo@example.com', [verifiedDomain('acme.com')])).toBe(false)
  })

  it('returns false on malformed email', () => {
    const rows = [verifiedDomain('acme.com')]
    expect(isEmailAtVerifiedDomain('not-an-email', rows)).toBe(false)
    expect(isEmailAtVerifiedDomain('@acme.com', rows)).toBe(false)
    expect(isEmailAtVerifiedDomain('', rows)).toBe(false)
  })

  it('matches when one of several rows is the verified row for that domain', () => {
    const rows = [
      verifiedDomain('acme.io'),
      pendingDomain('acquired.com'),
      verifiedDomain('acme.com'),
    ]
    expect(isEmailAtVerifiedDomain('alice@acme.com', rows)).toBe(true)
    expect(isEmailAtVerifiedDomain('alice@acquired.com', rows)).toBe(false)
    expect(isEmailAtVerifiedDomain('alice@other.com', rows)).toBe(false)
  })

  it('is independent of the enforced flag (routing-only predicate)', () => {
    const enforced = verifiedDomain('acme.com', { enforced: true })
    const notEnforced = verifiedDomain('acme.com', { enforced: false })
    expect(isEmailAtVerifiedDomain('alice@acme.com', [enforced])).toBe(true)
    expect(isEmailAtVerifiedDomain('alice@acme.com', [notEnforced])).toBe(true)
  })
})
