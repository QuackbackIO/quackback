/**
 * The one sentence under a record that needs fixing, for the ways a DNS host
 * mangles a long signing key value.
 */
import { describe, expect, it } from 'vitest'
import type { DnsRecordDTO } from '@/lib/server/functions/channel-accounts'
import { recordStatus } from '../dns-record-table'

const CHECKED = '2026-11-03T10:00:00.000Z'
const key = (check: DnsRecordDTO['check']): DnsRecordDTO => ({
  type: 'TXT',
  host: 'qb1._domainkey',
  value: `v=DKIM1; k=rsa; p=${'A'.repeat(392)}`,
  purpose: 'dkim',
  check,
})
const ctx = { domain: 'acme.com', phase: 'not-found' as const }

describe('recordStatus for a mangled signing key', () => {
  it('says the host cut the value short', () => {
    expect(
      recordStatus(
        key({
          state: 'mismatch',
          seen: 'v=DKIM1; k=rsa; p=AAA',
          reason: 'truncated',
          checkedAt: CHECKED,
        }),
        ctx
      )
    ).toEqual({
      state: 'problem',
      fix: 'Your DNS host cut this value short. Paste it again, or use Copy as parts.',
    })
  })

  it('says the value was saved with its quote marks', () => {
    expect(
      recordStatus(
        key({ state: 'mismatch', seen: '"v=DKIM1" "p=AAA"', reason: 'quoted', checkedAt: CHECKED }),
        ctx
      )
    ).toEqual({
      state: 'problem',
      fix: 'Your DNS host saved the quote marks as part of this value. Paste it again without them.',
    })
  })
})
