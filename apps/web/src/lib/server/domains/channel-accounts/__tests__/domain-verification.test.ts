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
import { describe, it, expect, vi } from 'vitest'
import type { SendingDomainDnsRecord, SendingDomainOwnershipRecord } from '@/lib/server/db'

/**
 * The bounded resolver every other domain check reads through. With no reader
 * passed, the check has to ask this one, never an unbounded lookup that can
 * hold a background job for as long as a silent nameserver keeps it waiting.
 */
const boundedTxt = vi.hoisted(() => vi.fn<(host: string) => Promise<string[][]>>())
vi.mock('@/lib/server/dns/resolver', () => ({
  systemResolver: { resolveTxt: (host: string) => boundedTxt(host) },
}))
import {
  checkSendingDomainOwnership,
  ownershipRecordSatisfied,
  verifySendingDomainDns,
} from '../domain-verification'
import { generateDkimKey } from '../dkim-key'

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

describe('verifySendingDomainDns with a row-minted signing key', () => {
  const keyA = generateDkimKey().record
  const keyB = generateDkimKey().record
  /** A zone that answers each name with what was published there, and nothing else. */
  const zoneOf =
    (published: Record<string, string[]>) =>
    async (host: string): Promise<string[][]> => {
      const values = published[host]
      if (!values) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' })
      // Long values arrive in chunks; split to prove they are joined.
      return values.map((v) => [v.slice(0, 100), v.slice(100)])
    }

  it('proves ownership when this row’s key is published at this row’s selector', async () => {
    const zone = zoneOf({ [`${keyA.host}.acme.com`]: [keyA.value] })
    expect(await verifySendingDomainDns('acme.com', [keyA], zone)).toBe(true)
  })

  it('matches on the key, forgiving spacing and tag order', async () => {
    const p = keyA.value.split('p=')[1]
    const zone = zoneOf({
      [`${keyA.host}.acme.com`]: [`p=${p.slice(0, 50)} ${p.slice(50)}; v=DKIM1`],
    })
    expect(await verifySendingDomainDns('acme.com', [keyA], zone)).toBe(true)
  })

  it('refuses another row’s key, at either selector', async () => {
    const zone = zoneOf({
      [`${keyB.host}.acme.com`]: [keyB.value],
      [`${keyA.host}.acme.com`]: [keyB.value],
    })
    expect(await verifySendingDomainDns('acme.com', [keyA], zone)).toBe(false)
    expect(await verifySendingDomainDns('acme.com', [keyB], zone)).toBe(true)
  })

  it('refuses a DKIM TXT that carries no key of its own', async () => {
    expect(
      await verifySendingDomainDns(
        'acme.com',
        [
          { type: 'TXT', host: 'x._domainkey', value: 'v=DKIM1; k=rsa', purpose: 'dkim' },
        ] as unknown as SendingDomainOwnershipRecord[],
        publishesEverything
      )
    ).toBe(false)
  })
})

describe('verifySendingDomainDns with no reader passed', () => {
  it('reads the zone through the bounded system resolver', async () => {
    boundedTxt.mockResolvedValue([[ownership.value]])
    expect(await verifySendingDomainDns('tenant-a.example', [ownership])).toBe(true)
    expect(boundedTxt).toHaveBeenCalledWith('_quackback.tenant-a.example')
  })
})

describe('checkSendingDomainOwnership tells a missing record from an unanswered lookup', () => {
  const failing = (code: string) => async (): Promise<string[][]> => {
    throw Object.assign(new Error(code), { code })
  }

  it('is proven when the record is published', async () => {
    const zone = async (host: string) =>
      host === '_quackback.acme.com' ? [[ownership.value]] : failing('ENODATA')()
    expect(await checkSendingDomainOwnership('acme.com', [ownership], zone)).toBe('proven')
  })

  it('is absent when the name answers with other records, or with nothing', async () => {
    expect(
      await checkSendingDomainOwnership('acme.com', [ownership], async () => [['v=spf1 -all']])
    ).toBe('absent')
    expect(await checkSendingDomainOwnership('acme.com', [ownership], failing('ENODATA'))).toBe(
      'absent'
    )
    expect(await checkSendingDomainOwnership('acme.com', [ownership], failing('ENOTFOUND'))).toBe(
      'absent'
    )
  })

  it('is unknown when the nameserver times out, fails or refuses', async () => {
    for (const code of ['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EREFUSED', 'ECANCELLED']) {
      expect(await checkSendingDomainOwnership('acme.com', [ownership], failing(code))).toBe(
        'unknown'
      )
    }
  })

  it('is absent when one record is missing, even if another could not be read', async () => {
    const keyA = generateDkimKey().record
    const zone = async (host: string): Promise<string[][]> =>
      host === '_quackback.acme.com' ? failing('ETIMEOUT')() : failing('ENODATA')()
    expect(await checkSendingDomainOwnership('acme.com', [ownership, keyA], zone)).toBe('absent')
  })

  it('never proves on an unanswered lookup, through the boolean check either', async () => {
    expect(await verifySendingDomainDns('acme.com', [ownership], failing('ETIMEOUT'))).toBe(false)
  })

  it('refuses an empty or non-ownership expectation as absent, not unknown', async () => {
    expect(await checkSendingDomainOwnership('acme.com', [], failing('ETIMEOUT'))).toBe('absent')
    expect(
      await checkSendingDomainOwnership(
        'acme.com',
        [
          { type: 'TXT', host: '@', value: 'v=spf1 -all', purpose: 'spf' },
        ] as unknown as SendingDomainOwnershipRecord[],
        failing('ETIMEOUT')
      )
    ).toBe('absent')
  })
})
