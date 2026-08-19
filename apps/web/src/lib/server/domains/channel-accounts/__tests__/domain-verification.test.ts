/**
 * Unit coverage for the DNS record matcher (§4.8): an SPF TXT matches on its
 * include even amid extra mechanisms; a DKIM CNAME matches case- and
 * trailing-dot-insensitively; a missing record does not match.
 */
import { describe, it, expect } from 'vitest'
import type { SendingDomainDnsRecord } from '@/lib/server/db'
import { recordSatisfied } from '../domain-verification'

const spf: SendingDomainDnsRecord = {
  type: 'TXT',
  host: '@',
  value: 'v=spf1 include:_spf.resend.com ~all',
  purpose: 'spf',
}
const dkim: SendingDomainDnsRecord = {
  type: 'CNAME',
  host: 'resend._domainkey',
  value: 'resend._domainkey.resend.com',
  purpose: 'dkim',
}

describe('recordSatisfied', () => {
  it('matches an SPF include even with extra mechanisms present', () => {
    expect(recordSatisfied(['v=spf1 include:_spf.resend.com ~all'], spf)).toBe(true)
    // A real record often carries the org's own mechanisms too.
    expect(
      recordSatisfied(['v=spf1 include:_spf.google.com include:_spf.resend.com -all'], spf)
    ).toBe(true)
  })

  it('does not match an SPF record missing the include', () => {
    expect(recordSatisfied(['v=spf1 include:_spf.google.com ~all'], spf)).toBe(false)
    expect(recordSatisfied([], spf)).toBe(false)
  })

  it('matches a DKIM CNAME case- and trailing-dot-insensitively', () => {
    expect(recordSatisfied(['resend._domainkey.resend.com'], dkim)).toBe(true)
    expect(recordSatisfied(['resend._domainkey.resend.com.'], dkim)).toBe(true)
    expect(recordSatisfied(['RESEND._DOMAINKEY.RESEND.COM'], dkim)).toBe(true)
  })

  it('does not match a DKIM CNAME pointing elsewhere', () => {
    expect(recordSatisfied(['resend._domainkey.other.com'], dkim)).toBe(false)
    expect(recordSatisfied([], dkim)).toBe(false)
  })
})
