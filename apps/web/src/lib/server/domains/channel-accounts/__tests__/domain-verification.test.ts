/**
 * Unit coverage for the ownership-record matcher.
 *
 * One record type with one rule, and the narrowness is the point. Everything a
 * domain owner publishes for us except this record is a value we hand out in
 * the instructions and is therefore byte-identical for every workspace that
 * follows them; matching one of those would verify a domain for whoever read
 * the instructions rather than for whoever owns the domain. So the token is
 * matched WHOLE, and a record that merely mentions it is not proof.
 */
import { describe, it, expect } from 'vitest'
import type { SendingDomainDnsRecord, SendingDomainOwnershipRecord } from '@/lib/server/db'
import { ownershipRecordSatisfied, verifySendingDomainDns } from '../domain-verification'

/**
 * A zone that has published EVERY record we hand out, plus a token.
 *
 * The refusals below have to be observed as refusals rather than as lookups
 * that happened to fail, and against a real resolver a reserved test domain
 * answers NXDOMAIN — the same `false` a refusal produces. So this zone is the
 * customer who followed the instructions exactly: the SPF line, the DKIM
 * target, everything. A check that would accept one of those as proof of
 * ownership therefore answers TRUE here, and the cases below fail. That is the
 * whole reason the resolver is a parameter.
 */
const PUBLISHED = 'anything at all'
const SPF_VALUE = 'v=spf1 include:amazonses.com ~all'
const DKIM_TARGET = 'aaa.dkim.eu-west-2.amazonses.com'
const publishesEverything = async () => [
  [PUBLISHED],
  [SPF_VALUE],
  [DKIM_TARGET],
  ['quackback-domain-verification=6f1c2a9e4b8d0f37'],
]

const ownership: SendingDomainOwnershipRecord = {
  type: 'TXT',
  host: '_quackback',
  value: 'quackback-domain-verification=6f1c2a9e4b8d0f37',
  purpose: 'ownership',
}

describe('ownershipRecordSatisfied', () => {
  it('matches only when the whole value is the token this row was issued', () => {
    expect(ownershipRecordSatisfied([ownership.value], ownership)).toBe(true)
    expect(ownershipRecordSatisfied([`  ${ownership.value}  `, 'unrelated'], ownership)).toBe(true)
    // A domain publishes plenty of TXT records; ours only has to be among them.
    expect(
      ownershipRecordSatisfied(['v=spf1 include:example.net ~all', ownership.value], ownership)
    ).toBe(true)
  })

  it('rejects another workspace’s token for the same domain', () => {
    expect(
      ownershipRecordSatisfied(['quackback-domain-verification=0000000000000000'], ownership)
    ).toBe(false)
  })

  it('rejects a record that merely carries the token as a fragment', () => {
    expect(ownershipRecordSatisfied([`${ownership.value} and-something-else`], ownership)).toBe(
      false
    )
    expect(ownershipRecordSatisfied([`prefix ${ownership.value}`], ownership)).toBe(false)
  })

  it('rejects a zone with nothing published, and an expectation with no token', () => {
    expect(ownershipRecordSatisfied([], ownership)).toBe(false)
    expect(ownershipRecordSatisfied([''], { ...ownership, value: '' })).toBe(false)
  })

  it('forgives case, because DNS does', () => {
    expect(ownershipRecordSatisfied([ownership.value.toUpperCase()], ownership)).toBe(true)
  })
})

describe('verifySendingDomainDns refuses to prove ownership from a public value', () => {
  it('would say yes to a real ownership record against this zone — the control', async () => {
    // Without this the refusals below could all be a resolver that answers
    // nothing, which is the shape that made the original seam untestable.
    expect(
      await verifySendingDomainDns(
        'tenant-a.example',
        [{ ...ownership, value: PUBLISHED }],
        publishesEverything
      )
    ).toBe(true)
  })

  /** Cast at the boundary: the compiler already refuses these, and the point of
   *  the cases is what happens when one arrives out of a jsonb column, where no
   *  type survives. */
  const asExpected = (r: SendingDomainDnsRecord) => [r] as unknown as SendingDomainOwnershipRecord[]

  it('refuses the SPF line we hand every workspace in the instructions', async () => {
    // The mutation that matters. This value is byte-identical for every
    // workspace on the account, so accepting it would verify a domain for
    // whoever followed the instructions rather than for whoever owns it — and
    // it never reaches DNS, so a passing lookup cannot rescue it.
    expect(
      await verifySendingDomainDns(
        'tenant-a.example',
        asExpected({
          type: 'TXT',
          host: 'bounce',
          value: SPF_VALUE,
          purpose: 'mail-from',
        }),
        publishesEverything
      )
    ).toBe(false)
  })

  it('refuses a DKIM CNAME, which the provider is the authority on anyway', async () => {
    expect(
      await verifySendingDomainDns(
        'tenant-a.example',
        asExpected({
          type: 'CNAME',
          host: 'aaa._domainkey',
          value: DKIM_TARGET,
          purpose: 'dkim',
        }),
        publishesEverything
      )
    ).toBe(false)
  })

  it('refuses an empty expectation: nothing published proves nothing', async () => {
    expect(await verifySendingDomainDns('tenant-a.example', [], publishesEverything)).toBe(false)
  })

  it('refuses a set where only ONE record is not an ownership record', async () => {
    // All-or-nothing, so a real token cannot launder a public value beside it.
    expect(
      await verifySendingDomainDns(
        'tenant-a.example',
        [
          ownership,
          ...asExpected({
            type: 'TXT',
            host: 'bounce',
            value: 'v=spf1 include:amazonses.com ~all',
            purpose: 'mail-from',
          }),
        ],
        publishesEverything
      )
    ).toBe(false)
  })
})
