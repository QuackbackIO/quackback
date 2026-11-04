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
})
