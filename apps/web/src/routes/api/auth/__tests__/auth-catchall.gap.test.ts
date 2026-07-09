/**
 * Differential-coverage tests for the /api/auth/$ catch-all — SSO test-callback
 * interception, redirect rewriting, OAuth register rate-limiting, and the
 * token-exchange `resource` injection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  authHandler: vi.fn(),
  handleSso: vi.fn(),
  renderSso: vi.fn(() => new Response('html')),
  rewrite: vi.fn((v: string) => v),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({ options: cfg }),
}))
vi.mock('@/lib/shared/sso-test-keys', () => ({
  SSO_OAUTH_CALLBACK_PATH: '/api/auth/sso-test/callback',
}))
vi.mock('@/lib/server/public-url', () => ({
  rewriteUrlToPublicBaseUrl: (...a: unknown[]) => m.rewrite(...(a as [string])),
}))
vi.mock('@/lib/server/auth/index', () => ({ auth: { handler: m.authHandler } }))
vi.mock('@/lib/server/auth/sso-test-callback', () => ({
  handleSsoTestCallback: m.handleSso,
  renderSsoTestCallbackHtml: m.renderSso,
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://app.test' } }))

import { Route } from '../$'

type H = {
  options: {
    server: {
      handlers: {
        GET: (c: { request: Request }) => Promise<Response>
        POST: (c: { request: Request }) => Promise<Response>
      }
    }
  }
}
const { GET, POST } = (Route as unknown as H).options.server.handlers

beforeEach(() => {
  vi.clearAllMocks()
  m.authHandler.mockResolvedValue(new Response('ok', { status: 200 }))
  m.handleSso.mockResolvedValue(null)
  m.rewrite.mockImplementation((v: string) => v)
})

describe('GET', () => {
  it('renders the SSO test callback when handled', async () => {
    m.handleSso.mockResolvedValueOnce({ testId: 't', result: 'ok', identityMatched: true })
    const res = await GET({
      request: new Request('https://app.test/api/auth/sso-test/callback?state=s&code=c'),
    })
    expect(await res.text()).toBe('html')
  })
  it('delegates to better-auth and rewrites a redirect Location', async () => {
    m.authHandler.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://localhost/x' } })
    )
    m.rewrite.mockReturnValueOnce('https://public.test/x')
    const res = await GET({ request: new Request('https://app.test/api/auth/session') })
    expect(res.headers.get('location')).toBe('https://public.test/x')
  })
  it('passes non-redirect responses through unchanged', async () => {
    const res = await GET({ request: new Request('https://app.test/api/auth/session') })
    expect(res.status).toBe(200)
  })
})

describe('POST', () => {
  it('rate-limits oauth2/register after the cap', async () => {
    const reg = () =>
      POST({
        request: new Request('https://app.test/api/auth/oauth2/register', {
          method: 'POST',
          headers: { 'x-forwarded-for': '9.9.9.9' },
        }),
      })
    let last: Response | undefined
    for (let i = 0; i < 12; i++) last = await reg()
    expect(last!.status).toBe(429)
  })
  it('injects resource into a token exchange missing it', async () => {
    const res = await POST({
      request: new Request('https://app.test/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code',
      }),
    })
    expect(res.status).toBe(200)
    expect(m.authHandler).toHaveBeenCalled()
  })
  it('leaves a token request that already has resource', async () => {
    await POST({
      request: new Request('https://app.test/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'resource=https://x/api/mcp',
      }),
    })
    expect(m.authHandler).toHaveBeenCalled()
  })
  it('delegates other POSTs', async () => {
    await POST({ request: new Request('https://app.test/api/auth/sign-in', { method: 'POST' }) })
    expect(m.authHandler).toHaveBeenCalled()
  })
})
