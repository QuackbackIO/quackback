import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  baseUrl: 'http://localhost:3000',
  eq: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  config: {
    get baseUrl() {
      return mocks.baseUrl
    },
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {},
  integrations: {},
  eq: mocks.eq,
}))

import { buildWebhookCallbackUrl, resolveWebhookBaseUrl } from '../webhook-registration'

function headers(input: Record<string, string>): Headers {
  return new Headers(input)
}

describe('webhook callback URL resolution', () => {
  beforeEach(() => {
    mocks.baseUrl = 'http://localhost:3000'
    vi.stubEnv('BASE_URL', '')
  })

  it('uses the configured public base URL when it is externally usable', () => {
    mocks.baseUrl = 'https://feedback.example.com/'

    expect(
      buildWebhookCallbackUrl('github', {
        requestHeaders: headers({
          host: 'melihs-macbook-pro.tail604752.ts.net',
          'x-forwarded-proto': 'https',
        }),
      })
    ).toBe('https://feedback.example.com/api/integrations/github/webhook')
  })

  it('uses the current HTTPS request origin when BASE_URL is localhost', () => {
    expect(
      buildWebhookCallbackUrl('github', {
        requestHeaders: headers({
          host: 'melihs-macbook-pro.tail604752.ts.net',
          'x-forwarded-proto': 'https',
        }),
      })
    ).toBe('https://melihs-macbook-pro.tail604752.ts.net/api/integrations/github/webhook')
  })

  it('prefers forwarded host headers from tunnels and reverse proxies', () => {
    expect(
      resolveWebhookBaseUrl(
        headers({
          host: 'localhost:3000',
          'x-forwarded-host': 'public.example.com',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe('https://public.example.com')
  })

  it('does not replace a local BASE_URL with another local request origin', () => {
    expect(
      buildWebhookCallbackUrl('github', {
        requestHeaders: headers({
          host: 'localhost:3000',
          'x-forwarded-proto': 'http',
        }),
      })
    ).toBe('http://localhost:3000/api/integrations/github/webhook')
  })
})
