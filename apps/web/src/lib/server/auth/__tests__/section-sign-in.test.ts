// @vitest-environment node
/**
 * Provider sign-in (OAuth, OIDC) asked for on a section host is moved to the
 * primary domain: the provider's callback and its state cookie live there.
 * The answer is the address the client navigates to (its popup or the page),
 * and it names the section host to hand the session back to. Every other host,
 * and every request made in process, is left to the library.
 */
import { describe, expect, it, vi } from 'vitest'
import { SECTION_SIGN_IN_PATH } from '@/lib/shared/section-handoff'

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://acme.com' },
  getBaseUrl: () => 'https://acme.com',
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => ({
    settings: { cloud: null, cloudIdentity: null },
    portalConfig: {
      sectionDomains: {
        help: { hostname: 'help.acme.com', verifiedAt: '2026-11-01T00:00:00.000Z' },
      },
      support: { enabled: false },
    },
    helpCenterConfig: { domain: { domain: null, verifiedAt: null } },
    featureFlags: { feedback: true, helpCenter: true, changelog: true },
    statusConfig: { enabled: false },
  }),
}))

const { sectionSignInMove } = await import('../section-sign-in')

function request(host: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://${host}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { host, ...headers },
  })
}

const SOCIAL = '/sign-in/social'

describe('sectionSignInMove', () => {
  it('moves a sign-in asked for on a section host to the primary domain', async () => {
    const moved = await sectionSignInMove({
      path: SOCIAL,
      request: request('help.acme.com'),
      body: {
        provider: 'github',
        callbackURL: '/hc/articles/x',
        errorCallbackURL: '/?auth=signin',
        loginHint: 'jo@example.com',
      },
    })
    expect(moved?.redirect).toBe(true)
    const url = new URL(moved!.url)
    expect(url.origin).toBe('https://acme.com')
    expect(url.pathname).toBe(SECTION_SIGN_IN_PATH)
    expect(url.searchParams.get('provider')).toBe('github')
    expect(url.searchParams.get('to')).toBe('help.acme.com')
    expect(url.searchParams.get('returnTo')).toBe('/hc/articles/x')
    expect(url.searchParams.get('errorReturnTo')).toBe('/?auth=signin')
    expect(url.searchParams.get('loginHint')).toBe('jo@example.com')
  })

  it('keeps an absolute callback on this host as its path', async () => {
    const moved = await sectionSignInMove({
      path: SOCIAL,
      request: request('help.acme.com'),
      body: { provider: 'github', callbackURL: 'https://help.acme.com/auth/auth-complete' },
    })
    const url = new URL(moved!.url)
    expect(url.searchParams.get('returnTo')).toBe('/auth/auth-complete')
    expect(url.searchParams.get('errorReturnTo')).toBe('/auth/auth-complete')
  })

  it('drops a callback that points anywhere else', async () => {
    const moved = await sectionSignInMove({
      path: SOCIAL,
      request: request('help.acme.com'),
      body: { provider: 'github', callbackURL: 'https://evil.example/x', errorCallbackURL: '//x' },
    })
    const url = new URL(moved!.url)
    expect(url.searchParams.get('returnTo')).toBe('/')
    expect(url.searchParams.get('errorReturnTo')).toBe('/')
  })

  it('leaves a sign-in on the primary domain to the library', async () => {
    expect(
      await sectionSignInMove({
        path: SOCIAL,
        request: request('acme.com'),
        body: { provider: 'github' },
      })
    ).toBeNull()
  })

  it('reads the host the edge vouches for, not a forwarded one', async () => {
    expect(
      await sectionSignInMove({
        path: SOCIAL,
        request: request('acme.com', { 'x-forwarded-host': 'help.acme.com' }),
        body: { provider: 'github' },
      })
    ).toBeNull()
  })

  it('answers the client in place of the provider when returned from a before hook', async () => {
    // The wiring in hooks.ts returns `ctx.json(moved)`; the library must
    // answer with it and never reach the provider.
    const { betterAuth } = await import('better-auth')
    const { createAuthMiddleware } = await import('better-auth/api')
    const auth = betterAuth({
      baseURL: 'https://acme.com',
      secret: 'test-secret-not-used-for-anything-real-0123456789',
      trustedOrigins: ['https://acme.com', 'https://help.acme.com'],
      socialProviders: { github: { clientId: 'id', clientSecret: 'secret' } },
      hooks: {
        before: createAuthMiddleware(async (ctx) => {
          const moved = await sectionSignInMove(ctx)
          if (moved) return ctx.json(moved)
        }),
      },
    })
    const response = await auth.handler(
      new Request('https://help.acme.com/api/auth/sign-in/social', {
        method: 'POST',
        headers: {
          host: 'help.acme.com',
          origin: 'https://help.acme.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ provider: 'github', callbackURL: '/hc' }),
      })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { url: string; redirect: boolean }
    expect(body.redirect).toBe(true)
    expect(new URL(body.url).pathname).toBe(SECTION_SIGN_IN_PATH)
    expect(body.url).not.toContain('github.com')
  })

  it('leaves in-process calls, id-token sign-in and other endpoints alone', async () => {
    expect(await sectionSignInMove({ path: SOCIAL, body: { provider: 'github' } })).toBeNull()
    expect(
      await sectionSignInMove({
        path: SOCIAL,
        request: request('help.acme.com'),
        body: { provider: 'google', idToken: { token: 'x' } },
      })
    ).toBeNull()
    expect(
      await sectionSignInMove({
        path: '/sign-in/email',
        request: request('help.acme.com'),
        body: { email: 'jo@example.com' },
      })
    ).toBeNull()
  })
})
