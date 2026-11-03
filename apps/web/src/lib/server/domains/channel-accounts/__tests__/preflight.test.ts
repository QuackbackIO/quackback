/**
 * Pre-flight for a new sending domain: who hosts its DNS, whether the MAIL FROM
 * name is free, and what DMARC says. The resolver is a zone that answers only
 * for the names it holds, so a lookup made against the wrong name finds nothing.
 */
import { describe, expect, it } from 'vitest'
import type { DnsResolver } from '../dns-resolver'
import { dnsHostFromNameservers, readDmarc, runPreflight } from '../preflight'

type Entry = {
  TXT?: string[][]
  CNAME?: string[]
  MX?: { exchange: string; priority: number }[]
  A?: string[]
  NS?: string[]
}

function zoneResolver(zone: Record<string, Entry>, failing = new Set<string>()): DnsResolver {
  const read = async <K extends keyof Entry>(host: string, kind: K) => {
    if (failing.has(host)) throw Object.assign(new Error('ETIMEOUT'), { code: 'ETIMEOUT' })
    const value = zone[host]?.[kind]
    if (!value || value.length === 0) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' })
    return value as NonNullable<Entry[K]>
  }
  return {
    resolveTxt: (h) => read(h, 'TXT'),
    resolveCname: (h) => read(h, 'CNAME'),
    resolveMx: (h) => read(h, 'MX'),
    resolve4: (h) => read(h, 'A'),
    resolveNs: (h) => read(h, 'NS'),
  }
}

const NOW = new Date('2026-11-03T10:00:00.000Z')

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
    expect(await runPreflight('acme.com', 'qb-bounce', resolver, NOW)).toEqual({
      dnsHost: 'cloudflare',
      mailFromFree: true,
      dmarc: { found: true, policy: 'none' },
      checkedAt: NOW.toISOString(),
    })
  })

  it.each([
    ['a TXT', { TXT: [['v=spf1 -all']] }],
    ['a CNAME', { CNAME: ['elsewhere.example.com'] }],
    ['an MX', { MX: [{ exchange: 'mx.example.com', priority: 10 }] }],
    ['an address', { A: ['192.0.2.1'] }],
  ])('finds the MAIL FROM name taken by %s', async (_label, entry) => {
    const resolver = zoneResolver({ 'qb-bounce.acme.com': entry as Entry })
    expect((await runPreflight('acme.com', 'qb-bounce', resolver, NOW)).mailFromFree).toBe(false)
  })

  it('looks at the label it was given', async () => {
    const resolver = zoneResolver({ 'bounce.acme.com': { A: ['192.0.2.1'] } })
    expect((await runPreflight('acme.com', 'qb-bounce', resolver, NOW)).mailFromFree).toBe(true)
    expect((await runPreflight('acme.com', 'bounce', resolver, NOW)).mailFromFree).toBe(false)
  })

  it('reads the nameservers of the zone a subdomain lives in', async () => {
    const resolver = zoneResolver({ 'acme.com': { NS: ['ns01.domaincontrol.com'] } })
    expect((await runPreflight('mail.acme.com', 'qb-bounce', resolver, NOW)).dnsHost).toBe(
      'godaddy'
    )
  })

  it('leaves out what it could not read', async () => {
    const resolver = zoneResolver(
      {},
      new Set(['acme.com', 'qb-bounce.acme.com', '_dmarc.acme.com'])
    )
    expect(await runPreflight('acme.com', 'qb-bounce', resolver, NOW)).toEqual({
      checkedAt: NOW.toISOString(),
    })
  })
})
