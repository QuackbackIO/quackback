import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCallbackUri, getPublicOriginFromHeaders, parseCookies } from '../oauth'

describe('OAuth public origin resolution', () => {
  beforeEach(() => {
    vi.stubEnv('BASE_URL', '')
  })

  it('prefers forwarded host and proto over the backend host', () => {
    const headers = new Headers({
      host: 'localhost:3000',
      'x-forwarded-host': 'melihs-macbook-pro.tail604752.ts.net',
      'x-forwarded-proto': 'https',
    })

    expect(getPublicOriginFromHeaders(headers, 'http://localhost:3000/oauth/github/connect')).toBe(
      'https://melihs-macbook-pro.tail604752.ts.net'
    )
  })

  it('uses the browser referrer when a proxy rewrites the host', () => {
    const headers = new Headers({
      host: 'localhost:3000',
      referer:
        'https://tests-pulling-school-intent.trycloudflare.com/admin/settings/integrations/github',
    })

    expect(getPublicOriginFromHeaders(headers, 'http://localhost:3000/oauth/github/connect')).toBe(
      'https://tests-pulling-school-intent.trycloudflare.com'
    )
  })

  it('falls back to the request host for direct local development', () => {
    const headers = new Headers({ host: 'localhost:3000' })

    expect(getPublicOriginFromHeaders(headers, 'http://localhost:3000/oauth/github/connect')).toBe(
      'http://localhost:3000'
    )
  })

  it('builds callback URIs from the public origin', () => {
    const request = new Request('http://localhost:3000/oauth/github/connect', {
      headers: {
        host: 'localhost:3000',
        referer:
          'https://tests-pulling-school-intent.trycloudflare.com/admin/settings/integrations/github',
      },
    })

    expect(buildCallbackUri('github', request)).toBe(
      'https://tests-pulling-school-intent.trycloudflare.com/oauth/github/callback'
    )
  })
})

describe('OAuth cookies', () => {
  it('parses cookie headers regardless of spacing after separators', () => {
    expect(parseCookies('a=1;b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' })
  })
})
