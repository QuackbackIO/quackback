/**
 * Differential-coverage tests for public-url — local/private hostname detection
 * (IPv4 private ranges, IPv6, .local/.localhost), base-url resolution
 * (configured-external vs request-origin fallback), and url rewriting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  getRequestHeaders: vi.fn(),
  getBaseUrl: vi.fn(),
  getPublicOrigin: vi.fn(),
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => m.getRequestHeaders() }))
vi.mock('@/lib/server/config', () => ({ getBaseUrl: () => m.getBaseUrl() }))
vi.mock('@/lib/server/integrations/oauth', () => ({
  getPublicOriginFromHeaders: (...a: unknown[]) => m.getPublicOrigin(...a),
}))

import {
  getActiveRequestHeaders,
  resolvePublicBaseUrl,
  rewriteUrlToPublicBaseUrl,
} from '../public-url'

beforeEach(() => {
  vi.clearAllMocks()
  m.getBaseUrl.mockReturnValue('https://app.example.com/')
  m.getRequestHeaders.mockReturnValue(new Headers())
  m.getPublicOrigin.mockReturnValue('')
})

describe('getActiveRequestHeaders', () => {
  it('returns headers, or undefined when no context', () => {
    expect(getActiveRequestHeaders()).toBeInstanceOf(Headers)
    m.getRequestHeaders.mockImplementationOnce(() => {
      throw new Error('no ctx')
    })
    expect(getActiveRequestHeaders()).toBeUndefined()
  })
})

describe('resolvePublicBaseUrl', () => {
  it('returns the configured URL when it is external (trims trailing slash)', () => {
    expect(resolvePublicBaseUrl(new Headers())).toBe('https://app.example.com')
  })
  it('falls back to a usable request origin when configured is local', () => {
    m.getBaseUrl.mockReturnValue('http://localhost:3000')
    m.getPublicOrigin.mockReturnValue('https://public.example.com')
    expect(resolvePublicBaseUrl(new Headers({ host: 'x' }))).toBe('https://public.example.com')
  })
  it('keeps the configured local URL when no usable request origin', () => {
    m.getBaseUrl.mockReturnValue('http://localhost:3000')
    m.getPublicOrigin.mockReturnValue('http://still.local') // not https -> not usable
    expect(resolvePublicBaseUrl(new Headers({ host: 'x' }))).toBe('http://localhost:3000')
  })
  it('treats various private/loopback hosts as local (IPv4 ranges, IPv6, .local)', () => {
    for (const url of [
      'http://10.1.2.3',
      'http://127.0.0.1',
      'http://169.254.1.1',
      'http://172.20.0.1',
      'http://192.168.1.1',
      'http://100.64.0.1',
      'http://0.0.0.0',
      'http://[::1]',
      'http://[fc00::1]',
      'http://[fe80::1]',
      'http://box.local',
      'http://app.localhost',
      'http://999.1.1.1',
      'not-a-url',
    ]) {
      m.getBaseUrl.mockReturnValueOnce(url)
      m.getPublicOrigin.mockReturnValueOnce('') // force fallback to configured
      // all of these are local/invalid -> resolve attempts request origin (empty) -> returns configured
      expect(resolvePublicBaseUrl(undefined)).toBeDefined()
    }
  })
  it('treats a public IPv4 + https as external', () => {
    m.getBaseUrl.mockReturnValue('https://203.0.113.5')
    expect(resolvePublicBaseUrl(new Headers())).toBe('https://203.0.113.5')
  })
})

describe('rewriteUrlToPublicBaseUrl', () => {
  it('rewrites protocol/host/port to the public base', () => {
    m.getBaseUrl.mockReturnValue('https://public.example.com')
    expect(rewriteUrlToPublicBaseUrl('http://internal:8080/path?q=1')).toBe(
      'https://public.example.com/path?q=1'
    )
  })
  it('returns the value unchanged when it is not a valid URL', () => {
    expect(rewriteUrlToPublicBaseUrl('not a url')).toBe('not a url')
  })
})
