/**
 * getClientIp() and TRUSTED_CLIENT_IP_HEADER: a single header the operator's
 * proxy sets or overwrites to the client address. It is honored only when
 * configured and only when it holds exactly one valid IP; anything else falls
 * back to the TRUSTED_PROXY_HOPS rules, with a throttled warning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { proxyConfig, mockGetRequestIP, mockWarn } = vi.hoisted(() => ({
  proxyConfig: { hops: 0, header: undefined as string | undefined },
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
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestIP: mockGetRequestIP,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: mockWarn }) },
}))

import { signCustomerHost, signEdgeClientIp } from '@/lib/server/workspaces/saas-edge-host'

const CLIENT = '198.51.100.23'
const PEER = '10.0.0.9'
const XFF = '192.0.2.1, 203.0.113.250'

function request(headers: Record<string, string>): Request {
  return new Request('https://app.example.com/api/v1/posts', { headers })
}

async function load() {
  vi.resetModules()
  return (await import('../rate-limit')).getClientIp
}

const trustedHeaderWarnings = () =>
  mockWarn.mock.calls.filter(([, msg]) => String(msg).includes('TRUSTED_CLIENT_IP_HEADER'))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
  proxyConfig.hops = 0
  proxyConfig.header = 'x-real-ip'
  mockGetRequestIP.mockReset()
  mockGetRequestIP.mockReturnValue(PEER)
  mockWarn.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('a configured trusted client address header', () => {
  it.each([0, 1, 2])('wins over X-Forwarded-For and the socket peer with hops %i', async (hops) => {
    proxyConfig.hops = hops
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF, 'x-real-ip': CLIENT }))).toBe(CLIENT)
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('trims surrounding whitespace and accepts IPv6', async () => {
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-real-ip': `  ${CLIENT} ` }))).toBe(CLIENT)
    expect(getClientIp(request({ 'x-real-ip': '2001:db8::7' }))).toBe('2001:db8::7')
  })

  it('reads whichever header is configured', async () => {
    proxyConfig.header = 'cf-connecting-ip'
    const getClientIp = await load()
    expect(getClientIp(request({ 'cf-connecting-ip': CLIENT, 'x-real-ip': '9.9.9.9' }))).toBe(
      CLIENT
    )
  })

  it('works with a Headers-only source', async () => {
    const getClientIp = await load()
    expect(getClientIp(new Headers({ 'x-real-ip': CLIENT }))).toBe(CLIENT)
  })

  it.each([
    ['a comma list', `9.9.9.9, ${CLIENT}`],
    ['a non-address', 'not-an-ip'],
    ['an empty value', ''],
    ['an address with a port', `${CLIENT}:443`],
  ])('falls back to the hop rules for %s', async (_label, value) => {
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-real-ip': value }))).toBe(PEER)
    proxyConfig.hops = 1
    expect(getClientIp(request({ 'x-real-ip': value, 'x-forwarded-for': XFF }))).toBe(
      '203.0.113.250'
    )
  })

  it('falls back when the header is absent', async () => {
    proxyConfig.hops = 1
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-forwarded-for': XFF }))).toBe('203.0.113.250')
  })

  it('warns at most once a minute, naming the header and never the value', async () => {
    const getClientIp = await load()
    getClientIp(request({ 'x-real-ip': '6.6.6.6, 7.7.7.7' }))
    getClientIp(request({}))
    getClientIp(request({ 'x-real-ip': 'garbage' }))
    expect(trustedHeaderWarnings()).toHaveLength(1)
    const [ctx] = trustedHeaderWarnings()[0]
    expect(ctx).toMatchObject({ header: 'x-real-ip' })
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('6.6.6.6')

    vi.advanceTimersByTime(59_000)
    getClientIp(request({}))
    expect(trustedHeaderWarnings()).toHaveLength(1)

    vi.advanceTimersByTime(1_000)
    getClientIp(request({}))
    expect(trustedHeaderWarnings()).toHaveLength(2)
  })

  it('does not raise the TRUSTED_PROXY_HOPS warning', async () => {
    const getClientIp = await load()
    getClientIp(request({ 'x-real-ip': CLIENT, 'x-forwarded-for': XFF }))
    getClientIp(request({ 'x-forwarded-for': XFF }))
    expect(
      mockWarn.mock.calls.filter(([, msg]) => String(msg).includes('TRUSTED_PROXY_HOPS is 0'))
    ).toHaveLength(0)
  })

  it('yields to a verified edge client address', async () => {
    const secret = 'edge-test-secret'
    const origin = 'origin.up.example'
    const customer = 'feedback.customer.test'
    const nowS = 1_800_000_000
    vi.stubEnv('QUACKBACK_SAAS_EDGE_SECRET', secret)
    vi.stubEnv('QUACKBACK_SAAS_RAILWAY_ORIGIN', origin)
    vi.stubEnv('QUACKBACK_SAAS_FALLBACK_ORIGIN', '')
    const getClientIp = await load()
    const headers = {
      host: origin,
      'x-real-ip': '10.1.1.1',
      'x-quackback-customer-host': customer,
      'x-quackback-customer-host-sig': signCustomerHost(secret, customer),
      'x-quackback-edge-client-ip': CLIENT,
      'x-quackback-edge-client-ip-sig': `${nowS}.${signEdgeClientIp(secret, customer, CLIENT, nowS)}`,
    }
    expect(getClientIp(new Request(`https://${origin}/`, { headers }))).toBe(CLIENT)
  })
})

describe('without a trusted client address header', () => {
  beforeEach(() => {
    proxyConfig.header = undefined
  })

  it('ignores a forged X-Real-IP on a direct install', async () => {
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-real-ip': '9.9.9.9' }))).toBe(PEER)
  })

  it('ignores a forged X-Real-IP behind trusted hops', async () => {
    proxyConfig.hops = 1
    const getClientIp = await load()
    expect(getClientIp(request({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': XFF }))).toBe(
      '203.0.113.250'
    )
  })

  it('still raises the TRUSTED_PROXY_HOPS warning and never the header one', async () => {
    const getClientIp = await load()
    getClientIp(request({ 'x-real-ip': '9.9.9.9' }))
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(trustedHeaderWarnings()).toHaveLength(0)
  })
})
