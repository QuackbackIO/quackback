/**
 * getClientIp() and the visitor address signed by the trusted edge proxy that
 * serves custom hostnames. That proxy is the TCP peer and the last
 * X-Forwarded-For hop of every custom-host request, so only its signed header
 * tells visitors apart. Anything short of a fully verified header must leave
 * the ordinary resolution rules in charge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { proxyConfig, mockGetRequestIP, mockWarn } = vi.hoisted(() => ({
  proxyConfig: { hops: 0 },
  mockGetRequestIP: vi.fn(),
  mockWarn: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get trustedProxyHops() {
      return proxyConfig.hops
    },
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestIP: mockGetRequestIP,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: mockWarn }) },
}))

import { getClientIp } from '../rate-limit'
import { signCustomerHost, signEdgeClientIp } from '@/lib/server/workspaces/saas-edge-host'

const SECRET = 'edge-test-secret'
const ORIGIN = 'origin.up.example'
const CUSTOMER = 'feedback.customer.test'
const VISITOR = '198.51.100.23'
const PROXY_PEER = '10.0.0.9'
const XFF_HOP = '203.0.113.250'
const NOW_S = 1_800_000_000

interface EdgeOverrides {
  host?: string
  customer?: string
  customerSig?: string | null
  ip?: string
  sig?: string | null
}

function edgeHeaders(overrides: EdgeOverrides = {}): Record<string, string> {
  const customer = overrides.customer ?? CUSTOMER
  const ip = overrides.ip ?? VISITOR
  const headers: Record<string, string> = {
    host: overrides.host ?? ORIGIN,
    'x-forwarded-for': `192.0.2.1, ${XFF_HOP}`,
    'x-quackback-customer-host': customer,
    'x-quackback-edge-client-ip': ip,
  }
  const customerSig =
    overrides.customerSig === undefined ? signCustomerHost(SECRET, customer) : overrides.customerSig
  if (customerSig !== null) headers['x-quackback-customer-host-sig'] = customerSig
  const sig =
    overrides.sig === undefined
      ? `${NOW_S}.${signEdgeClientIp(SECRET, customer, ip, NOW_S)}`
      : overrides.sig
  if (sig !== null) headers['x-quackback-edge-client-ip-sig'] = sig
  return headers
}

function request(headers: Record<string, string>): Request {
  return new Request(`https://${headers.host ?? ORIGIN}/api/v1/posts`, { headers })
}

const sigFor = (secret: string, host: string, ip: string, ts: number) =>
  `${ts}.${signEdgeClientIp(secret, host, ip, ts)}`

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_S * 1000)
  vi.stubEnv('QUACKBACK_SAAS_EDGE_SECRET', SECRET)
  vi.stubEnv('QUACKBACK_SAAS_RAILWAY_ORIGIN', ORIGIN)
  vi.stubEnv('QUACKBACK_SAAS_FALLBACK_ORIGIN', '')
  proxyConfig.hops = 1
  mockGetRequestIP.mockReset()
  mockGetRequestIP.mockReturnValue(PROXY_PEER)
  mockWarn.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('getClientIp with a signed edge visitor address', () => {
  it('uses the signed address over X-Forwarded-For when hops is 1', () => {
    expect(getClientIp(request(edgeHeaders()))).toBe(VISITOR)
  })

  it('uses the signed address over the socket peer when hops is 0', () => {
    proxyConfig.hops = 0
    expect(getClientIp(request(edgeHeaders()))).toBe(VISITOR)
  })

  it('works with a Headers-only source', () => {
    expect(getClientIp(new Headers(edgeHeaders()))).toBe(VISITOR)
  })

  it('accepts an IPv6 visitor address', () => {
    expect(getClientIp(request(edgeHeaders({ ip: '2001:db8::7' })))).toBe('2001:db8::7')
  })

  it('accepts timestamps exactly 300 seconds old or ahead', () => {
    for (const ts of [NOW_S - 300, NOW_S + 300]) {
      const headers = edgeHeaders({ sig: sigFor(SECRET, CUSTOMER, VISITOR, ts) })
      expect(getClientIp(request(headers))).toBe(VISITOR)
    }
  })

  it('does not raise the proxy warning for a trusted edge request when hops is 0', async () => {
    proxyConfig.hops = 0
    // A fresh module, since the warning fires at most once per process.
    vi.resetModules()
    const fresh = (await import('../rate-limit')).getClientIp
    expect(fresh(request(edgeHeaders()))).toBe(VISITOR)
    expect(mockWarn).not.toHaveBeenCalled()
    // The same module still warns for an unsigned proxied request.
    fresh(request({ host: ORIGIN, 'x-forwarded-for': XFF_HOP }))
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })
})

describe('getClientIp ignores an edge address that does not fully verify', () => {
  const cases: Array<[string, EdgeOverrides]> = [
    ['the signature uses the wrong secret', { sig: sigFor('wrong', CUSTOMER, VISITOR, NOW_S) }],
    [
      'the signature is for a different customer host',
      { sig: sigFor(SECRET, 'other.customer.test', VISITOR, NOW_S) },
    ],
    [
      'the signature is for a different address',
      { sig: sigFor(SECRET, CUSTOMER, '198.51.100.24', NOW_S) },
    ],
    [
      'the sent timestamp differs from the signed one',
      { sig: `${NOW_S}.${signEdgeClientIp(SECRET, CUSTOMER, VISITOR, NOW_S - 1)}` },
    ],
    ['the timestamp is 301 seconds old', { sig: sigFor(SECRET, CUSTOMER, VISITOR, NOW_S - 301) }],
    [
      'the timestamp is 301 seconds in the future',
      { sig: sigFor(SECRET, CUSTOMER, VISITOR, NOW_S + 301) },
    ],
    ['the signature header is missing', { sig: null }],
    [
      'the signature header has no timestamp',
      { sig: signEdgeClientIp(SECRET, CUSTOMER, VISITOR, NOW_S) },
    ],
    [
      'the signature hex is uppercase',
      { sig: `${NOW_S}.${signEdgeClientIp(SECRET, CUSTOMER, VISITOR, NOW_S).toUpperCase()}` },
    ],
    [
      'the timestamp is not an integer',
      { sig: `${NOW_S}.5.${signEdgeClientIp(SECRET, CUSTOMER, VISITOR, NOW_S)}` },
    ],
    ['the address is not an IP, even when correctly signed', { ip: 'not-an-ip' }],
    ['the customer-host signature is missing', { customerSig: null }],
    ['the customer-host signature is wrong', { customerSig: signCustomerHost('wrong', CUSTOMER) }],
    ['the request did not arrive on a trusted origin', { host: 'south.workspace.example' }],
  ]

  it.each(cases)('%s (hops 1: trusted X-Forwarded-For hop)', (_name, overrides) => {
    proxyConfig.hops = 1
    expect(getClientIp(request(edgeHeaders(overrides)))).toBe(XFF_HOP)
  })

  it.each(cases)('%s (hops 0: socket peer)', (_name, overrides) => {
    proxyConfig.hops = 0
    expect(getClientIp(request(edgeHeaders(overrides)))).toBe(PROXY_PEER)
  })

  it('the edge secret is unset', () => {
    vi.stubEnv('QUACKBACK_SAAS_EDGE_SECRET', '')
    expect(getClientIp(request(edgeHeaders()))).toBe(XFF_HOP)
    proxyConfig.hops = 0
    expect(getClientIp(request(edgeHeaders()))).toBe(PROXY_PEER)
  })
})

describe('warning about a rejected edge address', () => {
  // A fresh module per test, since the throttle timestamp is module state.
  async function freshGetClientIp() {
    vi.resetModules()
    return (await import('../rate-limit')).getClientIp
  }

  it.each<[string, EdgeOverrides, string]>([
    ['a bad signature', { sig: sigFor('drifted', CUSTOMER, VISITOR, NOW_S) }, 'signature-mismatch'],
    ['clock skew', { sig: sigFor(SECRET, CUSTOMER, VISITOR, NOW_S - 301) }, 'stale-timestamp'],
    ['a malformed signature', { sig: 'garbage' }, 'malformed-signature'],
    ['an invalid address', { ip: 'not-an-ip' }, 'invalid-address'],
    ['an untrusted origin', { host: 'south.workspace.example' }, 'untrusted-origin'],
    ['an unverified customer host', { customerSig: null }, 'unverified-customer-host'],
  ])('names %s as the reason', async (_name, overrides, reason) => {
    const fresh = await freshGetClientIp()
    expect(fresh(request(edgeHeaders(overrides)))).toBe(XFF_HOP)
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0][0]).toEqual({ reason })
    const logged = JSON.stringify(mockWarn.mock.calls[0])
    expect(logged).not.toContain(VISITOR)
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain(CUSTOMER)
  })

  it('logs at most once a minute', async () => {
    const fresh = await freshGetClientIp()
    const rejected = () =>
      request(
        edgeHeaders({ sig: sigFor('drifted', CUSTOMER, VISITOR, Math.floor(Date.now() / 1000)) })
      )
    fresh(rejected())
    fresh(rejected())
    vi.advanceTimersByTime(59_000)
    fresh(rejected())
    expect(mockWarn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_000)
    fresh(rejected())
    expect(mockWarn).toHaveBeenCalledTimes(2)
  })

  it('logs nothing for a valid header', async () => {
    const fresh = await freshGetClientIp()
    expect(fresh(request(edgeHeaders()))).toBe(VISITOR)
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('logs nothing when the edge secret is unset', async () => {
    vi.stubEnv('QUACKBACK_SAAS_EDGE_SECRET', '')
    const fresh = await freshGetClientIp()
    expect(fresh(request(edgeHeaders()))).toBe(XFF_HOP)
    expect(mockWarn).not.toHaveBeenCalled()
  })
})
