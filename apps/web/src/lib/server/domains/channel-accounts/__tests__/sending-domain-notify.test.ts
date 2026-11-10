/**
 * Which record the "needs attention" message names, and what it says about it.
 */
import { describe, expect, it } from 'vitest'
import type { EmailSendingDomain } from '@/lib/server/db'
import { failingRecord, formatDeadline, ownershipProblem } from '../sending-domain-notify'

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
})

describe('ownershipProblem', () => {
  it('names the ownership TXT with the value to add back', () => {
    const domain = {
      domain: 'acme.com',
      dkimMode: 'easy',
      dnsRecords: [
        {
          type: 'TXT',
          host: '_quackback',
          value: 'quackback-domain-verification=abc',
          purpose: 'ownership',
          check: { state: 'missing', checkedAt: CHECKED },
        },
      ],
    } as unknown as EmailSendingDomain
    expect(ownershipProblem(domain)).toEqual({
      purpose: 'ownership',
      type: 'TXT',
      name: '_quackback.acme.com',
      state: 'missing',
      value: 'quackback-domain-verification=abc',
    })
  })

  it('names the key TXT on a domain whose own key proves ownership', () => {
    const key = `v=DKIM1; k=rsa; p=${'A'.repeat(392)}`
    const domain = {
      domain: 'acme.com',
      dkimMode: 'byo',
      dnsRecords: [
        {
          type: 'TXT',
          host: 'qb1._domainkey',
          value: key,
          purpose: 'dkim',
          check: { state: 'missing', checkedAt: CHECKED },
        },
      ],
    } as unknown as EmailSendingDomain
    expect(ownershipProblem(domain)).toMatchObject({
      purpose: 'ownership',
      name: 'qb1._domainkey.acme.com',
      value: key,
    })
  })
})

describe('formatDeadline', () => {
  it('gives the day in UTC', () => {
    expect(formatDeadline(new Date('2026-11-17T23:30:00.000Z'))).toBe('November 17, 2026')
  })
})
