/**
 * With TRUSTED_PROXY_HOPS=0 every client behind a reverse proxy shares the
 * proxy's address and therefore one rate-limit bucket. getClientIp() logs a
 * single warning per process when it sees forwarding headers in that mode so
 * the operator learns to set TRUSTED_PROXY_HOPS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/v1/posts', { headers })
}

async function loadGetClientIp() {
  vi.resetModules()
  return (await import('../rate-limit')).getClientIp
}

describe('getClientIp proxy misconfiguration warning', () => {
  beforeEach(() => {
    proxyConfig.hops = 0
    mockWarn.mockReset()
    mockGetRequestIP.mockReset()
    mockGetRequestIP.mockReturnValue('172.18.0.2')
  })

  it.each(['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip'])(
    'warns when %s arrives while hops is 0',
    async (header) => {
      const getClientIp = await loadGetClientIp()
      getClientIp(requestWith({ [header]: '198.51.100.7' }))
      expect(mockWarn).toHaveBeenCalledTimes(1)
      expect(String(mockWarn.mock.calls[0][1])).toContain('TRUSTED_PROXY_HOPS')
    }
  )

  it('warns only once per process', async () => {
    const getClientIp = await loadGetClientIp()
    getClientIp(requestWith({ 'x-forwarded-for': '198.51.100.7' }))
    getClientIp(requestWith({ 'x-forwarded-for': '198.51.100.8' }))
    expect(mockWarn).toHaveBeenCalledTimes(1)
  })

  it('does not warn without forwarding headers', async () => {
    const getClientIp = await loadGetClientIp()
    getClientIp(requestWith({}))
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('does not warn when hops is configured', async () => {
    proxyConfig.hops = 1
    const getClientIp = await loadGetClientIp()
    getClientIp(requestWith({ 'x-forwarded-for': '198.51.100.7' }))
    expect(mockWarn).not.toHaveBeenCalled()
  })
})
