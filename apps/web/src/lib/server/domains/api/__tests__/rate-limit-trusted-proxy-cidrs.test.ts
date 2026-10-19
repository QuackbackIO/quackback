/**
 * getClientIp() and TRUSTED_PROXY_CIDRS: forwarding headers are read only on a
 * request whose socket peer is inside the configured list. A peer outside it is
 * the client, whatever headers it sends. With no list, behaviour is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { proxyConfig, mockGetRequestIP, mockWarn } = vi.hoisted(() => ({
  proxyConfig: {
    hops: 0,
    header: undefined as string | undefined,
    cidrs: [] as string[],
  },
  mockGetRequestIP: vi.fn(),
  mockWarn: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get trustedProxyHops() {
      return proxyConfig.hops
    },
    get trustedClientIpHeader() {
      return proxyConfig.header
    },
    get trustedProxyCidrs() {
      return proxyConfig.cidrs
    },
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestIP: mockGetRequestIP,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: mockWarn }) },
}))

import { signCustomerHost, signEdgeClientIp } from '@/lib/server/workspaces/saas-edge-host'

const PROXY = '192.0.2.7'
const OUTSIDER = '203.0.113.9'
const CLIENT = '198.51.100.23'
const XFF = `198.51.100.99, ${CLIENT}`

function request(headers: Record<string, string>): Request {
  return new Request('https://app.example.com/api/v1/posts', { headers })
}

async function load() {
  vi.resetModules()
  return (await import('../rate-limit')).getClientIp
}

beforeEach(() => {
  proxyConfig.hops = 1
  proxyConfig.header = undefined
  proxyConfig.cidrs = ['192.0.2.0/24']
  mockGetRequestIP.mockReset()
  mockGetRequestIP.mockReturnValue(PROXY)
  mockWarn.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('a request from a listed proxy', () => {
  it('uses the trusted hop of X-Forwarded-For', async () => {
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF }))).toBe(CLIENT)
  })

  it('uses the trusted client address header', async () => {
    proxyConfig.header = 'x-real-ip'
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-real-ip': CLIENT, 'x-forwarded-for': '9.9.9.9' }))).toBe(CLIENT)
  })

  it('still falls back to the hop rules when the header is missing', async () => {
    proxyConfig.header = 'x-real-ip'
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF }))).toBe(CLIENT)
  })

  it('resolves to the proxy itself under hops 0 without a header', async () => {
    proxyConfig.hops = 0
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF }))).toBe(PROXY)
  })

  it('accepts a peer reported in IPv6-mapped form', async () => {
    mockGetRequestIP.mockReturnValue(`::ffff:${PROXY}`)
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF }))).toBe(CLIENT)
  })

  it('accepts a listed IPv6 proxy', async () => {
    proxyConfig.cidrs = ['2001:db8::/32']
    mockGetRequestIP.mockReturnValue('2001:db8::5')
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF }))).toBe(CLIENT)
  })
})

describe('a request from a peer outside the list', () => {
  beforeEach(() => {
    mockGetRequestIP.mockReturnValue(OUTSIDER)
  })

  it.each([0, 1, 2])('ignores X-Forwarded-For with hops %i', async (hops) => {
    proxyConfig.hops = hops
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF }))).toBe(OUTSIDER)
  })

  it.each(['x-real-ip', 'cf-connecting-ip'])('ignores the trusted header %s', async (header) => {
    proxyConfig.header = header
    const getClientIp = await load()
    expect(getClientIp(request({ [header]: CLIENT, 'x-forwarded-for': XFF }))).toBe(OUTSIDER)
  })

  it('does not raise the missing-hops warning for a direct client', async () => {
    proxyConfig.hops = 0
    const getClientIp = await load()
    getClientIp(request({ 'x-forwarded-for': XFF }))
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('works with a Headers-only source', async () => {
    const getClientIp = await load()
    expect(getClientIp(new Headers({ 'x-forwarded-for': XFF }))).toBe(OUTSIDER)
  })
})

describe('a request without a usable socket peer', () => {
  it.each([undefined, 'not-an-ip'])('is unknown (peer %j)', async (peer) => {
    mockGetRequestIP.mockReturnValue(peer)
    proxyConfig.header = 'x-real-ip'
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-real-ip': CLIENT, 'x-forwarded-for': XFF }))).toBe('unknown')
  })

  it('is unknown when the platform cannot report a peer', async () => {
    mockGetRequestIP.mockImplementation(() => {
      throw new Error('no request context')
    })
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF }))).toBe('unknown')
  })
})

describe('without a CIDR list', () => {
  it('leaves the hop rules unchanged for any peer', async () => {
    proxyConfig.cidrs = []
    mockGetRequestIP.mockReturnValue(OUTSIDER)
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF }))).toBe(CLIENT)
  })
})

describe('a verified edge client address', () => {
  it('is honored before the peer check', async () => {
    const secret = 'edge-test-secret'
    const origin = 'origin.up.example'
    const customer = 'feedback.customer.test'
    const nowS = Math.floor(Date.now() / 1000)
    vi.stubEnv('QUACKBACK_SAAS_EDGE_SECRET', secret)
    vi.stubEnv('QUACKBACK_SAAS_RAILWAY_ORIGIN', origin)
    vi.stubEnv('QUACKBACK_SAAS_FALLBACK_ORIGIN', '')
    mockGetRequestIP.mockReturnValue(OUTSIDER)
    const getClientIp = await load()
    const headers = {
      host: origin,
      'x-quackback-customer-host': customer,
      'x-quackback-customer-host-sig': signCustomerHost(secret, customer),
      'x-quackback-edge-client-ip': CLIENT,
      'x-quackback-edge-client-ip-sig': `${nowS}.${signEdgeClientIp(secret, customer, CLIENT, nowS)}`,
    }
    expect(getClientIp(new Request(`https://${origin}/`, { headers }))).toBe(CLIENT)
  })
})
