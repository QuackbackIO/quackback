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
  ownershipSettled,
  recordLabel,
  recordTypeLabel,
  signingKeyFailing,
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

describe('an ownership record on a domain that has verified', () => {
  const ownership: DnsRecordDTO = {
    type: 'TXT',
    host: '_quackback',
    value: 'quackback-verification=abc',
    purpose: 'ownership',
    check: { state: 'missing', checkedAt: CHECKED },
  }
  const returnPathMx: DnsRecordDTO = {
    type: 'MX',
    host: 'qb-bounce',
    value: 'feedback-smtp.eu-west-2.amazonses.com',
    priority: 10,
    purpose: 'mail-from',
    check: { state: 'found', checkedAt: CHECKED },
  }
  const domainWith = (verifiedAt: string | null) =>
    ({
      domain: 'acme.com',
      verifiedAt,
      dkimMode: 'easy',
      dnsRecords: [ownership, returnPathMx],
    }) as SendingDomainDTO

  it('is not named as the record to fix once the domain has verified', () => {
    expect(failingRecordName(domainWith(CHECKED))).toBeNull()
    expect(signingKeyFailing(domainWith(CHECKED), 'attention')).toBe(true)
  })

  it('is still the record to fix before the domain has ever verified', () => {
    expect(failingRecordName(domainWith(null))).toBe('ownership record')
    expect(signingKeyFailing(domainWith(null), 'not-found')).toBe(false)
  })

  it('treats a shared domain’s own key record the same way', () => {
    const shared = {
      domain: 'acme.com',
      verifiedAt: CHECKED,
      dkimMode: 'shared',
      dnsRecords: [key({ state: 'missing', checkedAt: CHECKED }), returnPathMx],
    } as SendingDomainDTO
    expect(ownershipSettled(shared, shared.dnsRecords[0])).toBe(true)
    expect(failingRecordName(shared)).toBeNull()
    // On a domain that signs with that key, it is a signing record and still required.
    expect(ownershipSettled({ ...shared, dkimMode: 'byo' }, shared.dnsRecords[0])).toBe(false)
  })
})
