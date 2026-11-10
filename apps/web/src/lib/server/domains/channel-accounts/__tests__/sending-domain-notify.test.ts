/**
 * Which record the "needs attention" message names, and what it says about it.
 */
import { describe, expect, it } from 'vitest'
import type { EmailSendingDomain } from '@/lib/server/db'
import { failingRecord } from '../sending-domain-notify'

const CHECKED = '2026-11-03T10:00:00.000Z'

describe('failingRecord', () => {
  it('carries why a signing key value is wrong', () => {
    const domain = {
      domain: 'acme.com',
      dkimMode: 'byo',
      dnsRecords: [
        {
          type: 'TXT',
          host: 'qb1._domainkey',
          value: `v=DKIM1; k=rsa; p=${'A'.repeat(392)}`,
          purpose: 'dkim',
          check: {
            state: 'mismatch',
            seen: 'v=DKIM1; k=rsa; p=AAA',
            reason: 'truncated',
            checkedAt: CHECKED,
          },
        },
      ],
    } as unknown as EmailSendingDomain
    expect(failingRecord(domain)).toEqual({
      purpose: 'dkim',
      type: 'TXT',
      name: 'qb1._domainkey.acme.com',
      state: 'mismatch',
      seen: 'v=DKIM1; k=rsa; p=AAA',
      reason: 'truncated',
    })
  })

  const missing = { state: 'missing', checkedAt: CHECKED }
  const found = { state: 'found', checkedAt: CHECKED }
  const ownershipTxt = {
    type: 'TXT',
    host: '_quackback',
    value: 'quackback-verification=abc',
    purpose: 'ownership',
  }
  const returnPathMx = {
    type: 'MX',
    host: 'qb-bounce',
    value: 'feedback-smtp.eu-west-2.amazonses.com',
    priority: 10,
    purpose: 'mail-from',
  }

  it('names a missing ownership record on a domain that has never been verified', () => {
    const domain = {
      domain: 'acme.com',
      dkimMode: 'easy',
      verifiedAt: null,
      dnsRecords: [{ ...ownershipTxt, check: missing }],
    } as unknown as EmailSendingDomain
    expect(failingRecord(domain)).toMatchObject({ purpose: 'ownership' })
  })

  it('passes over the ownership record once the domain has been verified', () => {
    const domain = {
      domain: 'acme.com',
      dkimMode: 'easy',
      verifiedAt: new Date(CHECKED),
      dnsRecords: [
        { ...ownershipTxt, check: missing },
        { ...returnPathMx, check: missing },
      ],
    } as unknown as EmailSendingDomain
    expect(failingRecord(domain)).toMatchObject({ purpose: 'mail-from', type: 'MX' })
  })

  it('passes over the key record that only proves ownership once the domain has been verified', () => {
    const domain = {
      domain: 'acme.com',
      dkimMode: 'shared',
      verifiedAt: new Date(CHECKED),
      dnsRecords: [
        {
          type: 'TXT',
          host: 'qb1._domainkey',
          value: `v=DKIM1; k=rsa; p=${'A'.repeat(392)}`,
          purpose: 'dkim',
          check: missing,
        },
        { ...returnPathMx, check: found },
      ],
    } as unknown as EmailSendingDomain
    expect(failingRecord(domain)).toBe('signing-key')
  })
})
