import { afterEach, describe, expect, it, vi } from 'vitest'
import { posthogUiHost, relayToPostHog, upstreamFor } from '../analytics-relay'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('upstreamFor', () => {
  it('sends events to the ingestion host and SDK assets to the assets host', () => {
    expect(upstreamFor('https://us.i.posthog.com', '/e/')).toBe('https://us.i.posthog.com/e/')
    expect(upstreamFor('https://eu.i.posthog.com', '/static/array.js')).toBe(
      'https://eu-assets.i.posthog.com/static/array.js'
    )
    expect(upstreamFor('https://us.i.posthog.com', '/array/phc_x/config.js')).toBe(
      'https://us-assets.i.posthog.com/array/phc_x/config.js'
    )
  })

  it('keeps a self-hosted PostHog on its own host for both', () => {
    expect(upstreamFor('https://ph.example.com', '/static/x.js')).toBe(
      'https://ph.example.com/static/x.js'
    )
  })

  it('relays only the endpoints the SDK calls', () => {
    const host = 'https://ph.internal.example'
    for (const path of [
      '/e/',
      '/s/',
      '/i/v0/e/',
      '/i/v1/logs',
      '/flags/',
      '/decide/',
      '/batch/',
      '/static/array.js',
      '/array/phc_x/config.js',
      '/api/surveys/',
      '/api/early_access_features/',
    ]) {
      expect(upstreamFor(host, path)).toBe(`${host}${path}`)
    }
    for (const path of [
      '/',
      '/api/projects/1/',
      '/admin/',
      '/login',
      '/api/personal_api_keys/',
      '/e/../api/projects/1/',
      '/e/%2e%2e/api/projects/1/',
      '/static/../../admin',
    ]) {
      expect(upstreamFor(host, path)).toBeNull()
    }
  })

  it('refuses a path that could leave the PostHog host', () => {
    expect(upstreamFor('https://us.i.posthog.com', '//evil.test/x')).toBeNull()
    expect(upstreamFor('https://us.i.posthog.com', 'e/')).toBeNull()
  })
})

describe('posthogUiHost', () => {
  it('maps the ingestion host to the app host for toolbar links', () => {
    expect(posthogUiHost('https://us.i.posthog.com')).toBe('https://us.posthog.com')
    expect(posthogUiHost('https://eu.i.posthog.com')).toBe('https://eu.posthog.com')
    expect(posthogUiHost('https://ph.example.com')).toBe('https://ph.example.com')
  })
})

describe('relayToPostHog', () => {
  it('forwards the method, query, body and client address, and nothing that identifies the session', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await relayToPostHog(
      new Request('https://acme.example.com/api/relay/e/?ip=0&ver=1', {
        method: 'POST',
        body: 'payload',
        headers: {
          'content-type': 'text/plain',
          cookie: 'session=secret',
          authorization: 'Bearer secret',
          'x-forwarded-for': '203.0.113.9, 10.0.0.1',
        },
      }),
      { apiHost: 'https://us.i.posthog.com', prefix: '/api/relay' }
    )

    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://us.i.posthog.com/e/?ip=0&ver=1')
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('content-type')).toBe('text/plain')
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.9')
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('payload')
  })

  it('answers 404 for a path outside the relay', async () => {
    const res = await relayToPostHog(new Request('https://acme.example.com/elsewhere'), {
      apiHost: 'https://us.i.posthog.com',
      prefix: '/api/relay',
    })
    expect(res.status).toBe(404)
  })

  it('answers 502 when PostHog is unreachable, never throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      })
    )
    const res = await relayToPostHog(new Request('https://acme.example.com/api/relay/flags/'), {
      apiHost: 'https://us.i.posthog.com',
      prefix: '/api/relay',
    })
    expect(res.status).toBe(502)
  })

  it('does not pass on encodings the runtime already decoded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', {
            headers: {
              'content-type': 'application/json',
              'content-encoding': 'gzip',
              'content-length': '99',
              'set-cookie': 'x=1',
            },
          })
      )
    )
    const res = await relayToPostHog(new Request('https://acme.example.com/api/relay/flags/'), {
      apiHost: 'https://us.i.posthog.com',
      prefix: '/api/relay',
    })
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('content-encoding')).toBeNull()
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
