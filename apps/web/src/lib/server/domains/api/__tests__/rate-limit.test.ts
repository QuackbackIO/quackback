/**
 * Unit tests for getClientIp()'s two resolution modes.
 *
 * hops === 0 (direct exposure, the default): headers are never trusted;
 * only the platform-reported TCP peer address (via TanStack Start's
 * getRequestIP()) can identify the client. A client that spoofs
 * X-Forwarded-For/CF-Connecting-IP must not be able to mint a fresh
 * rate-limit bucket, and two distinct real peers must land in distinct
 * buckets.
 *
 * hops > 0 (behind N trusted reverse proxies): the client IP is read from
 * the (hops)-th X-Forwarded-For entry counting from the right, ignoring any
 * extra entries a client prepends and ignoring single-value headers like
 * CF-Connecting-IP/X-Real-IP entirely (they can't be tied to a hop
 * position, so trusting them would reopen the spoofing gap this model
 * closes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { proxyConfig, mockGetRequestIP } = vi.hoisted(() => ({
  proxyConfig: { hops: 0 },
  mockGetRequestIP: vi.fn(),
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

import { getClientIp } from '../rate-limit'

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/v1/posts', { headers })
}

describe('getClientIp, trustedProxyHops === 0 (direct exposure)', () => {
  beforeEach(() => {
    proxyConfig.hops = 0
    mockGetRequestIP.mockReset()
  })

  it('ignores a spoofed X-Forwarded-For and CF-Connecting-IP, using the socket peer instead', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.9')
    const request = requestWith({
      'x-forwarded-for': '6.6.6.6, 7.7.7.7',
      'cf-connecting-ip': '8.8.8.8',
      'x-real-ip': '9.9.9.9',
    })

    expect(getClientIp(request)).toBe('203.0.113.9')
  })

  it('gives distinct direct clients distinct buckets (peer-based, not a shared constant)', () => {
    mockGetRequestIP.mockReturnValueOnce('203.0.113.1')
    const first = getClientIp(requestWith({}))

    mockGetRequestIP.mockReturnValueOnce('203.0.113.2')
    const second = getClientIp(requestWith({}))

    expect(first).toBe('203.0.113.1')
    expect(second).toBe('203.0.113.2')
    expect(first).not.toBe(second)
  })

  it('falls back to the shared unknown bucket when no peer address is available', () => {
    mockGetRequestIP.mockReturnValue(undefined)
    expect(getClientIp(requestWith({ 'x-forwarded-for': '6.6.6.6' }))).toBe('unknown')
  })

  it('falls back to unknown when getRequestIP throws (no request context)', () => {
    mockGetRequestIP.mockImplementation(() => {
      throw new Error('No StartEvent found in AsyncLocalStorage')
    })
    expect(getClientIp(requestWith({}))).toBe('unknown')
  })

  it('falls back to unknown when the reported peer is not a valid IP', () => {
    mockGetRequestIP.mockReturnValue('not-an-ip')
    expect(getClientIp(requestWith({}))).toBe('unknown')
  })

  it('works with a Headers-only source, matching server-function call sites', () => {
    mockGetRequestIP.mockReturnValue('203.0.113.5')
    const headers = new Headers({ 'x-forwarded-for': '6.6.6.6' })
    expect(getClientIp(headers)).toBe('203.0.113.5')
  })
})

describe('getClientIp, trustedProxyHops > 0 (behind trusted reverse proxies)', () => {
  beforeEach(() => {
    mockGetRequestIP.mockReset()
  })

  it('picks the (hops)-th entry from the right of X-Forwarded-For', () => {
    proxyConfig.hops = 2
    // chain.length = 4, candidate index = max(0, 4 - 2) = 2 -> '3.3.3.3'
    const request = requestWith({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4' })
    expect(getClientIp(request)).toBe('3.3.3.3')
  })

  it('ignores extra entries a client prepends onto X-Forwarded-For', () => {
    proxyConfig.hops = 2
    const genuine = requestWith({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4' })
    const withSpoofPrefix = requestWith({
      'x-forwarded-for': 'evil-1, evil-2, evil-3, 1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4',
    })

    // Real proxies still appended the same trailing entries; only what a
    // client prepended further left changed, so the trusted-hop position
    // (counted from the right) resolves to the same genuine address.
    expect(getClientIp(withSpoofPrefix)).toBe(getClientIp(genuine))
    expect(getClientIp(genuine)).toBe('3.3.3.3')
  })

  it('does not trust CF-Connecting-IP or X-Real-IP even when configured', () => {
    proxyConfig.hops = 1
    const request = requestWith({
      'x-forwarded-for': '1.1.1.1, 2.2.2.2',
      'cf-connecting-ip': '9.9.9.9',
      'x-real-ip': '9.9.9.9',
    })
    // hops=1 -> candidate index = max(0, 2 - 1) = 1 -> '2.2.2.2', not the
    // single-value headers.
    expect(getClientIp(request)).toBe('2.2.2.2')
  })

  it('falls back to unknown when X-Forwarded-For is missing', () => {
    proxyConfig.hops = 1
    const request = requestWith({ 'cf-connecting-ip': '9.9.9.9' })
    expect(getClientIp(request)).toBe('unknown')
  })

  it('falls back to unknown when the resolved chain entry is not a valid IP', () => {
    proxyConfig.hops = 1
    const request = requestWith({ 'x-forwarded-for': 'not-an-ip, 2.2.2.2' })
    // hops=1 -> candidate index = max(0, 2 - 1) = 1 -> '2.2.2.2' is valid,
    // so pick a case where the trusted-hop position itself is bad.
    expect(getClientIp(request)).toBe('2.2.2.2')

    const badPosition = requestWith({ 'x-forwarded-for': '2.2.2.2, not-an-ip' })
    expect(getClientIp(badPosition)).toBe('unknown')
  })
})
