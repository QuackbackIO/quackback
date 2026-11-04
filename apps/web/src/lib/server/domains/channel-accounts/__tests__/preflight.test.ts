/**
 * Pre-flight for a new sending domain: who hosts its DNS, whether the MAIL FROM
 * name is free, and what DMARC says. The resolver is a zone that answers only
 * for the names it holds, so a lookup made against the wrong name finds nothing.
 * A `*.parent` entry answers for any name under that parent that holds nothing
 * of its own, the way a wildcard record does.
 */
import { describe, expect, it } from 'vitest'
import type { DnsResolver } from '@/lib/server/dns/resolver'
import { dnsHostFromNameservers, readDmarc, runPreflight } from '../preflight'

type Entry = {
  TXT?: string[][]
  CNAME?: string[]
  MX?: { exchange: string; priority: number }[]
  A?: string[]
  AAAA?: string[]
  NS?: string[]
}

function zoneResolver(zone: Record<string, Entry>, failing = new Set<string>()): DnsResolver {
  const read = async <K extends keyof Entry>(host: string, kind: K) => {
    if (failing.has(host)) throw Object.assign(new Error('ETIMEOUT'), { code: 'ETIMEOUT' })
    const entry = zone[host] ?? zone[`*.${host.split('.').slice(1).join('.')}`]
    const value = entry?.[kind]
    if (!value || value.length === 0) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' })
    return value as NonNullable<Entry[K]>
  }
  return {
    resolveTxt: (h) => read(h, 'TXT'),
    resolveCname: (h) => read(h, 'CNAME'),
    resolveMx: (h) => read(h, 'MX'),
    resolve4: (h) => read(h, 'A'),
    resolve6: (h) => read(h, 'AAAA'),
    resolveNs: (h) => read(h, 'NS'),
  }
}

const NOW = new Date('2026-11-03T10:00:00.000Z')
const REGION = 'us-east-1'
const OUR_MX = { exchange: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 }
const OUR_SPF = 'v=spf1 include:amazonses.com ~all'

const preflight = (resolver: DnsResolver, domain = 'acme.com', label = 'qb-bounce') =>
  runPreflight(domain, label, REGION, resolver, NOW)

describe('dnsHostFromNameservers', () => {
  it.each([
    [['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com.'], 'cloudflare'],
    [['ns-1.awsdns-01.org', 'ns-2.awsdns-02.co.uk'], 'route53'],
    [['ns01.domaincontrol.com'], 'godaddy'],
    [['dns1.registrar-servers.com'], 'namecheap'],
    [['ns-cloud-a1.googledomains.com'], 'google'],
    [['ns1.example.net'], 'other'],
    [['NS1.CLOUDFLARE.COM.EXAMPLE.NET'], 'other'],
  ])('%j is %s', (nameservers, host) => {
    expect(dnsHostFromNameservers(nameservers)).toBe(host)
  })

  it('names nothing when there are no nameservers', () => {
    expect(dnsHostFromNameservers([])).toBeUndefined()
  })
})

describe('readDmarc', () => {
  it('reads the policy from the record at _dmarc', async () => {
    const resolver = zoneResolver({
      '_dmarc.acme.com': { TXT: [['v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.com']] },
      '_dmarc.example.com': { TXT: [['v=DMARC1; p=reject']] },
    })
    expect(await readDmarc('acme.com', resolver)).toEqual({ found: true, policy: 'quarantine' })
  })

  it('reports not found when there is no DMARC record', async () => {
    const resolver = zoneResolver({ '_dmarc.acme.com': { TXT: [['some-other=value']] } })
    expect(await readDmarc('acme.com', resolver)).toEqual({ found: false })
  })

  it('answers undefined when the lookup fails, rather than claiming none', async () => {
    const resolver = zoneResolver({}, new Set(['_dmarc.acme.com']))
    expect(await readDmarc('acme.com', resolver)).toBeUndefined()
  })
})

describe('runPreflight', () => {
  it('reads the host, finds the MAIL FROM name free and reads DMARC', async () => {
    const resolver = zoneResolver({
      'acme.com': { NS: ['ada.ns.cloudflare.com'] },
      '_dmarc.acme.com': { TXT: [['v=DMARC1; p=none']] },
    })
    expect(await preflight(resolver)).toEqual({
      dnsHost: 'cloudflare',
      mailFromFree: true,
      dmarc: { found: true, policy: 'none' },
      checkedAt: NOW.toISOString(),
    })
  })

  it.each([
    ['a CNAME', { CNAME: ['elsewhere.example.com'] }],
    ['an MX that is not ours', { MX: [{ exchange: 'mx.example.com', priority: 10 }] }],
    [
      'our MX for another region',
      { MX: [{ exchange: 'feedback-smtp.eu-west-1.amazonses.com', priority: 10 }] },
    ],
    ['an SPF record that is not ours', { TXT: [['v=spf1 -all']] }],
  ])('finds the MAIL FROM name taken by %s', async (_label, entry) => {
    const resolver = zoneResolver({ 'qb-bounce.acme.com': entry as Entry })
    expect((await preflight(resolver)).mailFromFree).toBe(false)
  })

  it.each([
    ['an address', { A: ['192.0.2.1'] }],
    ['a TXT that is not SPF', { TXT: [['site-verification=abc']] }],
  ])(
    'leaves the MAIL FROM name free beside %s, which coexists with MX and SPF',
    async (_l, entry) => {
      const resolver = zoneResolver({ 'qb-bounce.acme.com': entry as Entry })
      expect((await preflight(resolver)).mailFromFree).toBe(true)
    }
  )

  it('leaves the name free when what is there is our own MX and SPF, as on a re-add', async () => {
    const resolver = zoneResolver({
      'qb-bounce.acme.com': {
        MX: [{ ...OUR_MX, exchange: `${OUR_MX.exchange}.` }],
        TXT: [[OUR_SPF]],
      },
    })
    expect((await preflight(resolver)).mailFromFree).toBe(true)
  })

  it('does not count answers that come from a wildcard', async () => {
    // Every name under acme.com answers with these, so they say nothing about
    // qb-bounce in particular, and an explicit record there overrides them.
    const resolver = zoneResolver({
      '*.acme.com': {
        A: ['192.0.2.1'],
        MX: [{ exchange: 'mx.example.com', priority: 10 }],
        TXT: [['v=spf1 include:example.com -all']],
        CNAME: ['catchall.example.com'],
      },
    })
    expect((await preflight(resolver)).mailFromFree).toBe(true)
  })

  it('still finds an explicit record beside a wildcard', async () => {
    const resolver = zoneResolver({
      '*.acme.com': { A: ['192.0.2.1'], MX: [{ exchange: 'mx.example.com', priority: 10 }] },
      'qb-bounce.acme.com': { MX: [{ exchange: 'mx.example.com', priority: 10 }] },
    })
    // Identical to the wildcard's answer, so it cannot be told apart from it.
    expect((await preflight(resolver)).mailFromFree).toBe(true)
    const differing = zoneResolver({
      '*.acme.com': { A: ['192.0.2.1'] },
      'qb-bounce.acme.com': { MX: [{ exchange: 'mx.example.com', priority: 10 }] },
    })
    expect((await preflight(differing)).mailFromFree).toBe(false)
  })

  it('does not know, rather than refuse, when the name cannot be read', async () => {
    const resolver = zoneResolver({}, new Set(['qb-bounce.acme.com']))
    expect((await preflight(resolver)).mailFromFree).toBeUndefined()
  })

  it('looks at the label it was given', async () => {
    const resolver = zoneResolver({ 'bounce.acme.com': { CNAME: ['elsewhere.example.com'] } })
    expect((await preflight(resolver)).mailFromFree).toBe(true)
    expect((await preflight(resolver, 'acme.com', 'bounce')).mailFromFree).toBe(false)
  })

  it('reads the nameservers of the zone a subdomain lives in', async () => {
    const resolver = zoneResolver({ 'acme.com': { NS: ['ns01.domaincontrol.com'] } })
    expect((await preflight(resolver, 'mail.acme.com')).dnsHost).toBe('godaddy')
  })

  it('leaves out what it could not read', async () => {
    const resolver = zoneResolver(
      {},
      new Set(['acme.com', 'qb-bounce.acme.com', '_dmarc.acme.com'])
    )
    expect(await preflight(resolver)).toEqual({
      checkedAt: NOW.toISOString(),
    })
  })
})

describe('runPreflight for a return path that is one CNAME', () => {
  const TARGET = 'ws-0123456789abcdef01234567.bounces.example.net'
  const cname = (resolver: DnsResolver) =>
    runPreflight('acme.com', 'qb-bounce', REGION, resolver, NOW, TARGET)

  it('finds the name free when nothing is there', async () => {
    expect((await cname(zoneResolver({}))).mailFromFree).toBe(true)
  })

  it.each([
    ['an address', { A: ['192.0.2.1'] }],
    ['an IPv6 address', { AAAA: ['2001:db8::1'] }],
    ['a TXT that is not SPF', { TXT: [['site-verification=abc']] }],
    ['our own MX and SPF from an earlier setup', { MX: [OUR_MX], TXT: [[OUR_SPF]] }],
    ['a CNAME elsewhere', { CNAME: ['elsewhere.example.com'] }],
  ])('finds the name taken by %s, since nothing may sit beside a CNAME', async (_l, entry) => {
    const resolver = zoneResolver({ 'qb-bounce.acme.com': entry as Entry })
    expect((await cname(resolver)).mailFromFree).toBe(false)
  })

  it('finds the name free when it already holds our CNAME, as on a re-add', async () => {
    // A resolver follows the CNAME, so the target's MX and SPF answer here too.
    const resolver = zoneResolver({
      'qb-bounce.acme.com': { CNAME: [`${TARGET.toUpperCase()}.`], MX: [OUR_MX], TXT: [[OUR_SPF]] },
    })
    expect((await cname(resolver)).mailFromFree).toBe(true)
  })

  it('does not count answers that come from a wildcard', async () => {
    const resolver = zoneResolver({
      '*.acme.com': { A: ['192.0.2.1'], TXT: [['v=spf1 -all']], CNAME: ['catchall.example.com'] },
    })
    expect((await cname(resolver)).mailFromFree).toBe(true)
  })

  it('does not know, rather than refuse, when the name cannot be read', async () => {
    const resolver = zoneResolver({}, new Set(['qb-bounce.acme.com']))
    expect((await cname(resolver)).mailFromFree).toBeUndefined()
  })
})
