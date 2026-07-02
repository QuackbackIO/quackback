/**
 * Differential-coverage tests for integrations/oauth — public-origin resolution
 * (forwarded / x-forwarded-* / origin / host / tailnet→configured / fallback),
 * secure-request detection, cookie name variants + parse/build/clear, callback
 * URI, redirect response, and return-domain resolution.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ getRequestHeaders: vi.fn() }))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => m.getRequestHeaders() }))

import {
  getPublicOriginFromHeaders,
  getPublicOriginFromRequest,
  getOAuthReturnDomain,
  isSecureRequest,
  getStateCookieName,
  getStateCookieNameVariants,
  parseCookies,
  buildCallbackUri,
  redirectResponse,
  createCookie,
  clearCookie,
  clearStateCookies,
  isValidTenantDomain,
} from '../oauth'

const H = (o: Record<string, string>) => new Headers(o)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.BASE_URL = 'https://app.example.com'
})
afterEach(() => {
  delete process.env.BASE_URL
})

describe('getPublicOriginFromHeaders', () => {
  it('prefers x-forwarded-host + proto', () => {
    expect(
      getPublicOriginFromHeaders(
        H({ 'x-forwarded-host': 'pub.example.com', 'x-forwarded-proto': 'https' })
      )
    ).toBe('https://pub.example.com')
  })
  it('parses a Forwarded header (host + proto)', () => {
    expect(getPublicOriginFromHeaders(H({ forwarded: 'proto=https;host=fwd.example.com' }))).toBe(
      'https://fwd.example.com'
    )
  })
  it('redirects a private tailnet origin to the configured origin', () => {
    expect(
      getPublicOriginFromHeaders(
        H({ 'x-forwarded-host': 'box.tail.ts.net', 'x-forwarded-proto': 'https' })
      )
    ).toBe('https://app.example.com')
  })
  it('falls back to the origin/referer header', () => {
    expect(getPublicOriginFromHeaders(H({ origin: 'https://from-origin.test/path' }))).toBe(
      'https://from-origin.test'
    )
    expect(getPublicOriginFromHeaders(H({ referer: 'https://from-referer.test/x' }))).toBe(
      'https://from-referer.test'
    )
  })
  it('falls back to the host header and finally the configured origin', () => {
    expect(getPublicOriginFromHeaders(H({ host: 'h.example.com' }))).toBe('https://h.example.com')
    expect(getPublicOriginFromHeaders(H({}))).toBe('https://app.example.com')
  })
  it('uses the request url origin for protocol when present', () => {
    expect(
      getPublicOriginFromRequest(
        new Request('http://req.test/cb', { headers: { host: 'req.test' } })
      )
    ).toContain('req.test')
  })
})

describe('secure + cookies', () => {
  it('detects a secure request via x-forwarded-proto', () => {
    expect(
      isSecureRequest(new Request('https://x.test', { headers: { 'x-forwarded-proto': 'https' } }))
    ).toBe(true)
    expect(isSecureRequest(new Request('http://x.test'))).toBe(false)
  })
  it('names the state cookie (secure vs not) and lists variants', () => {
    expect(
      getStateCookieName(
        'github',
        new Request('https://x.test', { headers: { 'x-forwarded-proto': 'https' } })
      )
    ).toBe('__Secure-github_oauth_state')
    expect(getStateCookieName('github', new Request('http://x.test'))).toBe('github_oauth_state')
    expect(getStateCookieNameVariants('github')).toEqual([
      '__Secure-github_oauth_state',
      'github_oauth_state',
    ])
  })
  it('parses, builds, and clears cookies', () => {
    expect(parseCookies('a=1; b=2=3')).toEqual({ a: '1', b: '2=3' })
    expect(parseCookies('')).toEqual({})
    expect(createCookie('n', 'v', true, 60)).toContain('Secure;')
    expect(createCookie('n', 'v', false, 60)).not.toContain('Secure;')
    expect(clearCookie('n', true)).toContain('Max-Age=0')
    expect(clearStateCookies('github')).toHaveLength(2)
  })
})

describe('misc helpers', () => {
  it('builds a callback URI and a redirect response', () => {
    expect(
      buildCallbackUri(
        'github',
        new Request('https://x.test/cb', {
          headers: { host: 'x.test', 'x-forwarded-proto': 'https' },
        })
      )
    ).toContain('/oauth/github/callback')
    const res = redirectResponse('https://x.test/next', ['c=1'])
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://x.test/next')
  })
  it('getOAuthReturnDomain uses request headers, falling back to configured', () => {
    m.getRequestHeaders.mockReturnValueOnce(
      H({ host: 'rh.example.com', 'x-forwarded-proto': 'https' })
    )
    expect(getOAuthReturnDomain()).toBe('rh.example.com')
    m.getRequestHeaders.mockImplementationOnce(() => {
      throw new Error('no ctx')
    })
    expect(getOAuthReturnDomain()).toBe('app.example.com')
  })
  it('isValidTenantDomain is always true (self-hosted)', () => {
    expect(isValidTenantDomain('anything')).toBe(true)
  })
})
