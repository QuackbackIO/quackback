import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  exchangeGitLabCode,
  getGitLabOAuthUrl,
  refreshGitLabToken,
} from '@/integrations/gitlab/server/oauth'

// GitLab requests go through the SSRF guard; route them to the stubbed global
// fetch so the assertions below see the same calls.
vi.mock('@/lib/server/content/ssrf-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/content/ssrf-guard')>()),
  safeFetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}))

const creds = { clientId: 'app-id', clientSecret: 'app-secret' }

function mockFetch(handlers: Array<{ url: string | RegExp; status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const handler = handlers.find((h) =>
      typeof h.url === 'string' ? url === h.url || url.startsWith(h.url) : h.url.test(url)
    )
    if (!handler) throw new Error(`unexpected fetch: ${url}`)
    return {
      ok: handler.status >= 200 && handler.status < 300,
      status: handler.status,
      json: async () => handler.body,
      text: async () => JSON.stringify(handler.body),
    }
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getGitLabOAuthUrl', () => {
  it('authorizes against gitlab.com when instanceUrl is omitted', () => {
    const url = getGitLabOAuthUrl(
      'state-1',
      'https://app.example.com/oauth/gitlab/callback',
      {},
      creds
    )
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://gitlab.com')
    expect(parsed.pathname).toBe('/oauth/authorize')
    expect(parsed.searchParams.get('client_id')).toBe('app-id')
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/oauth/gitlab/callback'
    )
    expect(parsed.searchParams.get('scope')).toBe('api')
  })

  it('authorizes against a custom HTTPS instance', () => {
    const url = getGitLabOAuthUrl(
      'state-1',
      'https://app.example.com/oauth/gitlab/callback',
      {},
      {
        ...creds,
        instanceUrl: 'https://gitlab.example.com/',
      }
    )
    expect(new URL(url).origin).toBe('https://gitlab.example.com')
    expect(url).toContain('/oauth/authorize?')
  })

  it('throws when the client ID is missing', () => {
    expect(() => getGitLabOAuthUrl('s', 'https://app.example.com/cb')).toThrow(/client ID/)
  })
})

describe('exchangeGitLabCode', () => {
  it('exchanges against gitlab.com and omits instanceUrl from config', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        {
          url: 'https://gitlab.com/oauth/token',
          status: 200,
          body: { access_token: 'tok', refresh_token: 'ref', expires_in: 7200 },
        },
        {
          url: 'https://gitlab.com/api/v4/user',
          status: 200,
          body: { name: 'Ada', username: 'ada' },
        },
      ])
    )

    const result = await exchangeGitLabCode(
      'code-1',
      'https://app.example.com/oauth/gitlab/callback',
      {},
      creds
    )

    expect(result.accessToken).toBe('tok')
    expect(result.config).toEqual({
      workspaceName: 'Ada',
      oauthRedirectUri: 'https://app.example.com/oauth/gitlab/callback',
    })
    expect(result.config).not.toHaveProperty('instanceUrl')
  })

  it('exchanges against a custom instance and persists the origin', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        {
          url: 'https://gitlab.example.com/oauth/token',
          status: 200,
          body: { access_token: 'tok', refresh_token: 'ref', expires_in: 7200 },
        },
        {
          url: 'https://gitlab.example.com/api/v4/user',
          status: 200,
          body: { username: 'ada' },
        },
      ])
    )

    const result = await exchangeGitLabCode(
      'code-1',
      'https://app.example.com/oauth/gitlab/callback',
      {},
      { ...creds, instanceUrl: 'https://gitlab.example.com/' }
    )

    expect(result.accessToken).toBe('tok')
    expect(result.config).toEqual({
      workspaceName: 'ada',
      oauthRedirectUri: 'https://app.example.com/oauth/gitlab/callback',
      instanceUrl: 'https://gitlab.example.com',
    })
  })
})

it('refreshes against the installed GitLab instance with the original callback URI', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 7200 })
  )
  vi.stubGlobal('fetch', fetch)
  await expect(
    refreshGitLabToken(
      'old-refresh',
      { ...creds, instanceUrl: 'https://gitlab.example.com' },
      {
        instanceUrl: 'https://gitlab.example.com',
        oauthRedirectUri: 'https://app.example.com/oauth/gitlab/callback',
      }
    )
  ).resolves.toEqual({ accessToken: 'fresh', refreshToken: 'rotated', expiresIn: 7200 })
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('https://gitlab.example.com/oauth/token')
  expect(JSON.parse(String(init.body))).toMatchObject({
    grant_type: 'refresh_token',
    refresh_token: 'old-refresh',
    redirect_uri: 'https://app.example.com/oauth/gitlab/callback',
  })
})
it('does not send a refresh token to a changed GitLab instance', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(
    refreshGitLabToken(
      'old-refresh',
      { ...creds, instanceUrl: 'https://different.example.com' },
      {
        instanceUrl: 'https://gitlab.example.com',
        oauthRedirectUri: 'https://app.example.com/oauth/gitlab/callback',
      }
    )
  ).rejects.toThrow('Reconnect')
  expect(fetch).not.toHaveBeenCalled()
})
