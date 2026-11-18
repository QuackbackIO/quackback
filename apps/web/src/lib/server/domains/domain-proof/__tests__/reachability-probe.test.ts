// @vitest-environment node
/**
 * The check a self-hosted custom domain gets: DNS resolves and this server
 * answers on it. The zone is a fake that answers per name and counts the
 * tries, and the request this server makes to itself is a stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Answer = string[] | 'nodata' | 'timeout'
const zone = vi.hoisted(() => ({
  /** Per name and record type, the answers in turn; the last one repeats. */
  records: new Map<string, Answer[]>(),
  asked: [] as string[],
}))

function answer(name: string, type: 'A' | 'AAAA'): Promise<string[]> {
  zone.asked.push(`${type} ${name}`)
  const answers = zone.records.get(`${type} ${name}`) ?? ['nodata']
  const next = answers.length > 1 ? answers.shift()! : answers[0]
  if (next === 'nodata')
    return Promise.reject(Object.assign(new Error('nodata'), { code: 'ENODATA' }))
  if (next === 'timeout')
    return Promise.reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }))
  return Promise.resolve(next)
}

const fakeResolver = {
  resolve4: (name: string) => answer(name, 'A'),
  resolve6: (name: string) => answer(name, 'AAAA'),
  resolveTxt: async () => [],
  resolveCname: async () => [],
  resolveMx: async () => [],
  resolveNs: async () => [],
}

vi.mock('@/lib/server/dns/resolver', () => ({
  systemResolver: {
    ...fakeResolver,
    resolve4: () => Promise.reject(new Error('the one-try resolver was used')),
    resolve6: () => Promise.reject(new Error('the one-try resolver was used')),
  },
  interactiveResolver: fakeResolver,
}))

const { probeCustomDomain } = await import('../reachability-probe')

type Reply = 'ok' | 'unreachable' | 'error-page'
let reply: Reply = 'ok'
/** The host the answer says this server saw; undefined sends no such header. */
let seenHost: string | undefined
const fetched: string[] = []

beforeEach(() => {
  zone.records = new Map()
  zone.asked = []
  reply = 'ok'
  seenHost = undefined
  fetched.length = 0
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url)
    if (reply === 'unreachable') throw new TypeError('fetch failed')
    return new Response('{}', {
      status: reply === 'ok' ? 200 : 502,
      headers: seenHost === undefined ? {} : { 'x-quackback-host': seenHost },
    })
  })
})
afterEach(() => vi.unstubAllGlobals())

const set = (type: 'A' | 'AAAA', name: string, ...answers: Answer[]) =>
  zone.records.set(`${type} ${name}`, answers)

describe('probeCustomDomain', () => {
  it('verifies a hostname that resolves and reaches this server', async () => {
    set('A', 'help.acme.com', ['203.0.113.7'])
    const { status, dnsAnswered } = await probeCustomDomain('help.acme.com')
    expect(status).toEqual({ dnsResolved: true, instanceReachable: true, verified: true })
    expect(dnsAnswered).toBe(true)
    expect(fetched).toEqual(['https://help.acme.com/api/health'])
  })

  it('verifies when this server says it saw the hostname asked for, in any case', async () => {
    set('A', 'help.acme.com', ['203.0.113.7'])
    seenHost = 'Help.Acme.com'
    expect((await probeCustomDomain('help.acme.com')).status.verified).toBe(true)
  })

  it('does not verify behind a proxy that hands this server another Host', async () => {
    // A plain GET passes there, yet routing never sees the hostname.
    set('A', 'help.acme.com', ['203.0.113.7'])
    set('A', 'feedback.acme.com', ['203.0.113.7'])
    seenHost = 'feedback.acme.com'
    const { status } = await probeCustomDomain('help.acme.com', {
      primaryHost: 'feedback.acme.com',
    })
    expect(status).toEqual({ dnsResolved: true, instanceReachable: false, verified: false })
  })

  it('reads DNS through the resolver that tries twice', async () => {
    set('AAAA', 'help.acme.com', ['2001:db8::7'])
    expect((await probeCustomDomain('help.acme.com')).status.dnsResolved).toBe(true)
  })

  it('says DNS gave no answer when a lookup timed out and nothing resolved', async () => {
    set('A', 'help.acme.com', 'timeout')
    reply = 'unreachable'
    const { status, dnsAnswered } = await probeCustomDomain('help.acme.com')
    expect(status.verified).toBe(false)
    expect(dnsAnswered).toBe(false)
  })

  describe('a hostname at the primary domain address that this server cannot reach itself through', () => {
    // Hairpin NAT, or egress to its own address blocked: the request this
    // server makes to its own hostname never gets an answer.
    beforeEach(() => {
      reply = 'unreachable'
      set('A', 'feedback.acme.com', ['203.0.113.7'])
      set('AAAA', 'feedback.acme.com', ['2001:db8::7'])
    })

    it('is verified when it shares an IPv4 address with the primary domain', async () => {
      set('A', 'help.acme.com', ['198.51.100.1', '203.0.113.7'])
      const { status } = await probeCustomDomain('help.acme.com', {
        primaryHost: 'feedback.acme.com',
      })
      expect(status).toEqual({
        dnsResolved: true,
        instanceReachable: false,
        verified: true,
        sharesPrimaryAddress: true,
      })
    })

    it('is verified when it shares an IPv6 address', async () => {
      set('AAAA', 'help.acme.com', ['2001:db8::7'])
      const { status } = await probeCustomDomain('help.acme.com', {
        primaryHost: 'feedback.acme.com',
      })
      expect(status.verified).toBe(true)
    })

    it('is verified against a BASE_URL that names an address', async () => {
      set('A', 'help.acme.com', ['192.0.2.10'])
      expect(
        (await probeCustomDomain('help.acme.com', { primaryHost: '192.0.2.10' })).status.verified
      ).toBe(true)
      set('AAAA', 'status.acme.com', ['2001:db8::10'])
      expect(
        (await probeCustomDomain('status.acme.com', { primaryHost: '[2001:db8::10]' })).status
          .verified
      ).toBe(true)
    })

    it('is not verified at an address the primary domain does not have', async () => {
      set('A', 'help.acme.com', ['198.51.100.1'])
      const { status } = await probeCustomDomain('help.acme.com', {
        primaryHost: 'feedback.acme.com',
      })
      expect(status).toEqual({ dnsResolved: true, instanceReachable: false, verified: false })
    })

    it('is not verified when something else answered there', async () => {
      // A server answered, so the request did reach a server, and not this one.
      reply = 'error-page'
      set('A', 'help.acme.com', ['203.0.113.7'])
      const { status } = await probeCustomDomain('help.acme.com', {
        primaryHost: 'feedback.acme.com',
      })
      expect(status.verified).toBe(false)
    })

    it('is not verified without the primary host to compare', async () => {
      set('A', 'help.acme.com', ['203.0.113.7'])
      expect((await probeCustomDomain('help.acme.com')).status.verified).toBe(false)
    })
  })
})
