/**
 * The one sentence under a record that needs fixing, for the ways a DNS host
 * mangles a long signing key value, and how a return path CNAME reads.
 */
import { describe, expect, it } from 'vitest'
import type { DnsRecordDTO, SendingDomainDTO } from '@/lib/server/functions/channel-accounts'
import { recordStatus } from '../dns-record-table'
import {
  failingRecordName,
  instructionsText,
  recordLabel,
  recordTypeLabel,
} from '../sending-domain-view'

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

describe('a DKIM key record', () => {
  it('is labelled and named DKIM', () => {
    expect(recordLabel(key(undefined), 'byo')).toBe('DKIM')
    const domain = {
      domain: 'acme.com',
      dnsRecords: [key({ state: 'missing', checkedAt: CHECKED })],
    } as SendingDomainDTO
    expect(failingRecordName(domain)).toBe('DKIM record')
  })
})

describe('a return path that is one CNAME', () => {
  const returnPath = (check?: DnsRecordDTO['check']): DnsRecordDTO => ({
    type: 'CNAME',
    host: 'qb-bounce',
    value: 'ws-abc.bounces.example.net',
    purpose: 'mail-from',
    check,
  })

  it('is labelled, typed and listed like any return path record', () => {
    expect(recordLabel(returnPath(), 'byo')).toBe('Return path')
    expect(recordTypeLabel(returnPath())).toBe('CNAME')
    const domain = {
      domain: 'acme.com',
      dnsRecords: [
        returnPath({ state: 'mismatch', seen: 'ws-other.bounces.example.net', checkedAt: CHECKED }),
      ],
    } as SendingDomainDTO
    expect(failingRecordName(domain)).toBe('return path record')
    expect(instructionsText(domain)).toContain('CNAME  qb-bounce  ws-abc.bounces.example.net')
  })

  it('names the target found when it points elsewhere', () => {
    expect(
      recordStatus(
        returnPath({ state: 'mismatch', seen: 'ws-other.bounces.example.net', checkedAt: CHECKED }),
        ctx
      )
    ).toEqual({
      state: 'problem',
      fix: 'This name has a different value: ws-other.bounces.example.net. Replace it with the value above.',
    })
  })
})
