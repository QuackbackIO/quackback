/**
 * Per-record DNS checks for a sending domain.
 *
 * The resolver is a zone: it answers only for the names it holds, and a name
 * it does not hold answers the way a real resolver does (ENODATA). A fake that
 * answered every name alike could not tell the record's own name from the
 * doubled one, or a CNAME from an A record at the same place.
 */
import { describe, expect, it } from 'vitest'
import type { SendingDomainDnsRecord } from '@/lib/server/db'
import { checkRecord, checkRecords, type DnsResolver } from '../record-check'

type Zone = Record<
  string,
  {
    TXT?: string[][]
    CNAME?: string[]
    MX?: { exchange: string; priority: number }[]
    A?: string[]
    NS?: string[]
  }
>

function noData(host: string): Error {
  return Object.assign(new Error(`queryX ENODATA ${host}`), { code: 'ENODATA' })
}

function zoneResolver(
  zone: Zone,
  failing: Set<string> = new Set()
): DnsResolver & {
  asked: string[]
} {
  const asked: string[] = []
  const read = async <K extends keyof Zone[string]>(host: string, kind: K) => {
    asked.push(`${kind} ${host}`)
    if (failing.has(host)) {
      throw Object.assign(new Error(`queryX ETIMEOUT ${host}`), { code: 'ETIMEOUT' })
    }
    const value = zone[host]?.[kind]
    if (!value || value.length === 0) throw noData(host)
    return value as NonNullable<Zone[string][K]>
  }
  return {
    asked,
    resolveTxt: (host) => read(host, 'TXT'),
    resolveCname: (host) => read(host, 'CNAME'),
    resolveMx: (host) => read(host, 'MX'),
    resolve4: (host) => read(host, 'A'),
    resolveNs: (host) => read(host, 'NS'),
  }
}

const NOW = new Date('2026-11-03T10:00:00.000Z')
const DOMAIN = 'acme.com'

const ownership: SendingDomainDnsRecord = {
  type: 'TXT',
  host: '_quackback',
  value: 'quackback-domain-verification=abc123',
  purpose: 'ownership',
}
const dkim: SendingDomainDnsRecord = {
  type: 'CNAME',
  host: 'tok1._domainkey',
  value: 'tok1.dkim.eu-west-2.amazonses.com',
  purpose: 'dkim',
}
const mx: SendingDomainDnsRecord = {
  type: 'MX',
  host: 'qb-bounce',
  value: 'feedback-smtp.eu-west-2.amazonses.com',
  priority: 10,
  purpose: 'mail-from',
}
const spf: SendingDomainDnsRecord = {
  type: 'TXT',
  host: 'qb-bounce',
  value: 'v=spf1 include:amazonses.com ~all',
  purpose: 'mail-from',
}

const check = (record: SendingDomainDnsRecord, zone: Zone) =>
  checkRecord(DOMAIN, record, zoneResolver(zone), NOW)

describe('TXT records', () => {
  it.each([
    [
      'found, joined across chunks',
      { '_quackback.acme.com': { TXT: [['quackback-domain-', 'verification=abc123']] } },
      { state: 'found' },
    ],
    [
      'found, ignoring case and whitespace',
      { '_quackback.acme.com': { TXT: [[' QUACKBACK-domain-verification=ABC123 ']] } },
      { state: 'found' },
    ],
    [
      'mismatch, naming the value with the same prefix',
      {
        '_quackback.acme.com': {
          TXT: [['google-site-verification=x'], ['quackback-domain-verification=old999']],
        },
      },
      { state: 'mismatch', seen: 'quackback-domain-verification=old999' },
    ],
    [
      'missing when only unrelated values are there',
      { '_quackback.acme.com': { TXT: [['google-site-verification=x']] } },
      { state: 'missing' },
    ],
    ['missing when nothing is there', {}, { state: 'missing' }],
    [
      'mismatch, naming the doubled name',
      { '_quackback.acme.com.acme.com': { TXT: [['quackback-domain-verification=abc123']] } },
      { state: 'mismatch', seen: '_quackback.acme.com.acme.com', reason: 'doubled-name' },
    ],
  ] as const)('%s', async (_label, zone, expected) => {
    expect(await check(ownership, zone as Zone)).toEqual({
      ...expected,
      checkedAt: NOW.toISOString(),
    })
  })

  it('reads the SPF value at the MAIL FROM host, not the apex', async () => {
    const zone: Zone = {
      'acme.com': { TXT: [['v=spf1 include:amazonses.com ~all']] },
      'qb-bounce.acme.com': { TXT: [['v=spf1 include:_spf.example.com ~all']] },
    }
    expect(await check(spf, zone)).toMatchObject({
      state: 'mismatch',
      seen: 'v=spf1 include:_spf.example.com ~all',
    })
  })
})

describe('a signing key TXT', () => {
  const key: SendingDomainDnsRecord = {
    type: 'TXT',
    host: 'qb1a2b3c4d._domainkey',
    value: 'v=DKIM1; k=rsa; p=MIGfMA0KEYA',
    purpose: 'dkim',
  }
  const NAME = 'qb1a2b3c4d._domainkey.acme.com'

  it.each([
    [
      'the same key, split and spaced differently',
      { [NAME]: { TXT: [['v=DKIM1; k=rsa; p=MIGf', 'MA0 KEYA']] } },
      { state: 'found' },
    ],
    [
      'a different key',
      { [NAME]: { TXT: [['v=DKIM1; k=rsa; p=OTHERKEY']] } },
      { state: 'mismatch', seen: 'v=DKIM1; k=rsa; p=OTHERKEY' },
    ],
    ['nothing', {}, { state: 'missing' }],
    [
      'an address where the TXT should be',
      { [NAME]: { A: ['192.0.2.1'] } },
      { state: 'proxied', seen: '192.0.2.1' },
    ],
    [
      'the key under the domain typed twice',
      { [`${NAME}.acme.com`]: { TXT: [['v=DKIM1; k=rsa; p=MIGfMA0KEYA']] } },
      { state: 'mismatch', seen: `${NAME}.acme.com`, reason: 'doubled-name' },
    ],
  ])('finds %s', async (_label, zone, expected) => {
    expect(await checkRecord(DOMAIN, key, zoneResolver(zone as Zone), NOW)).toEqual({
      ...expected,
      checkedAt: NOW.toISOString(),
    })
  })
})

describe('CNAME records', () => {
  it.each([
    [
      'found, ignoring a trailing dot and case',
      { 'tok1._domainkey.acme.com': { CNAME: ['TOK1.dkim.eu-west-2.amazonses.com.'] } },
      { state: 'found' },
    ],
    [
      'mismatch on a wrong target',
      { 'tok1._domainkey.acme.com': { CNAME: ['tok1.dkim.us-east-1.amazonses.com'] } },
      { state: 'mismatch', seen: 'tok1.dkim.us-east-1.amazonses.com' },
    ],
    [
      'proxied when the name answers with addresses instead',
      { 'tok1._domainkey.acme.com': { A: ['104.16.0.1'] } },
      { state: 'proxied', seen: '104.16.0.1' },
    ],
    ['missing when nothing is there', {}, { state: 'missing' }],
    [
      'mismatch, naming the doubled name',
      { 'tok1._domainkey.acme.com.acme.com': { CNAME: ['tok1.dkim.eu-west-2.amazonses.com'] } },
      { state: 'mismatch', seen: 'tok1._domainkey.acme.com.acme.com', reason: 'doubled-name' },
    ],
  ] as const)('%s', async (_label, zone, expected) => {
    expect(await check(dkim, zone as Zone)).toEqual({ ...expected, checkedAt: NOW.toISOString() })
  })
})

describe('MX records', () => {
  it.each([
    [
      'found',
      {
        'qb-bounce.acme.com': {
          MX: [{ exchange: 'feedback-smtp.eu-west-2.amazonses.com', priority: 10 }],
        },
      },
      { state: 'found' },
    ],
    [
      'mismatch on the priority',
      {
        'qb-bounce.acme.com': {
          MX: [{ exchange: 'feedback-smtp.eu-west-2.amazonses.com', priority: 20 }],
        },
      },
      { state: 'mismatch', seen: '20 feedback-smtp.eu-west-2.amazonses.com' },
    ],
    [
      'mismatch on the exchange',
      { 'qb-bounce.acme.com': { MX: [{ exchange: 'mx.example.com', priority: 10 }] } },
      { state: 'mismatch', seen: '10 mx.example.com' },
    ],
    ['missing when nothing is there', {}, { state: 'missing' }],
    [
      'mismatch, naming the doubled name',
      {
        'qb-bounce.acme.com.acme.com': {
          MX: [{ exchange: 'feedback-smtp.eu-west-2.amazonses.com', priority: 10 }],
        },
      },
      { state: 'mismatch', seen: 'qb-bounce.acme.com.acme.com', reason: 'doubled-name' },
    ],
  ] as const)('%s', async (_label, zone, expected) => {
    expect(await check(mx, zone as Zone)).toEqual({ ...expected, checkedAt: NOW.toISOString() })
  })
})

describe('a lookup that fails', () => {
  it('answers null rather than a state, so a timeout never reads as missing', async () => {
    const resolver = zoneResolver({}, new Set(['_quackback.acme.com']))
    expect(await checkRecord(DOMAIN, ownership, resolver, NOW)).toBeNull()
  })
})

describe('checkRecords', () => {
  it('attaches a check to every record, keeping the previous one where a lookup failed', async () => {
    const previous = { state: 'found' as const, checkedAt: '2026-11-02T10:00:00.000Z' }
    const resolver = zoneResolver(
      { '_quackback.acme.com': { TXT: [['quackback-domain-verification=abc123']] } },
      new Set(['tok1._domainkey.acme.com'])
    )
    const checked = await checkRecords(
      DOMAIN,
      [ownership, { ...dkim, check: previous }, mx],
      resolver,
      NOW
    )
    expect(checked.map((r) => r.check)).toEqual([
      { state: 'found', checkedAt: NOW.toISOString() },
      previous,
      { state: 'missing', checkedAt: NOW.toISOString() },
    ])
    // The records themselves are what was asked for, untouched.
    expect(checked.map(({ check: _check, ...r }) => r)).toEqual([ownership, dkim, mx])
  })
})
