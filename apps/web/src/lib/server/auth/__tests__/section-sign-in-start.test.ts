// @vitest-environment node
/**
 * The primary domain's end of a provider sign-in started on a section host.
 * It starts the provider sign-in here, where the callback and its state
 * cookie live, with a callback that is the handoff back to the section host.
 * `to` must be a routable section host of this workspace: anything else gets
 * no sign-in and no redirect off this host.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ signInSocial: vi.fn() }))

vi.mock('@/lib/server/auth', () => ({
  auth: { api: { signInSocial: hoisted.signInSocial } },
}))
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
        roadmap: { hostname: 'roadmap.acme.com', verifiedAt: null },
      },
      support: { enabled: false },
    },
    helpCenterConfig: { domain: { domain: null, verifiedAt: null } },
    featureFlags: { feedback: true, helpCenter: true, changelog: true },
    statusConfig: { enabled: false },
  }),
}))

const { startSectionSignIn } = await import('../section-sign-in')

function get(host: string, params: Record<string, string>): Request {
  return new Request(
    `https://${host}/auth/section-sign-in?${new URLSearchParams(params).toString()}`,
    { headers: { host } }
  )
}

const STATE_COOKIE = 'better-auth.state=abc; Path=/; HttpOnly; SameSite=Lax'

beforeEach(() => {
  hoisted.signInSocial.mockReset()
  hoisted.signInSocial.mockResolvedValue(
    new Response(JSON.stringify({ url: 'https://idp.example.com/authorize?x=1', redirect: true }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': STATE_COOKIE },
    })
  )
})

describe('startSectionSignIn', () => {
  it('starts the provider sign-in here and asks to come back through the handoff', async () => {
    const response = await startSectionSignIn(
      get('acme.com', {
        provider: 'github',
        to: 'help.acme.com',
        returnTo: '/hc/articles/x',
        errorReturnTo: '/?auth=signin',
        loginHint: 'jo@example.com',
      })
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://idp.example.com/authorize?x=1')
    // The state cookie lands on this host, where the callback will read it.
    expect(response.headers.getSetCookie()).toContain(STATE_COOKIE)
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cache-control')).toBe('no-store')

    const { body } = hoisted.signInSocial.mock.calls[0]![0] as {
      body: Record<string, string>
    }
    expect(body.provider).toBe('github')
    expect(body.loginHint).toBe('jo@example.com')
    const callback = new URL(body.callbackURL!)
    expect(callback.origin).toBe('https://help.acme.com')
    expect(callback.pathname).toBe('/auth/section-handoff')
    expect(callback.searchParams.get('from')).toBe('acme.com')
    expect(callback.searchParams.get('returnTo')).toBe('/hc/articles/x')
    expect(body.errorCallbackURL).toBe('https://help.acme.com/?auth=signin')
  })

  it('never builds a callback from an unsafe path', async () => {
    await startSectionSignIn(
      get('acme.com', { provider: 'github', to: 'help.acme.com', returnTo: '//evil.example' })
    )
    const { body } = hoisted.signInSocial.mock.calls[0]![0] as {
      body: Record<string, string>
    }
    expect(new URL(body.callbackURL!).searchParams.get('returnTo')).toBe('/')
    expect(body.errorCallbackURL).toBe('https://help.acme.com/')
  })

  it.each([
    ['a host outside the workspace', 'evil.example'],
    ['a mapped host that is not verified', 'roadmap.acme.com'],
    ['the primary domain itself', 'acme.com'],
    ['nothing', ''],
  ])('starts nothing and stays on this host for %s', async (_label, to) => {
    const response = await startSectionSignIn(
      get('acme.com', { provider: 'github', to, returnTo: '/' })
    )
    expect(hoisted.signInSocial).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('/')
  })

  it('gets the provider address and a state cookie from the real library', async () => {
    // The contract the mocks above stand in for: an in-process call with
    // asResponse answers with the provider URL and sets the state cookie.
    const { betterAuth } = await import('better-auth')
    const real = betterAuth({
      baseURL: 'https://acme.com',
      secret: 'test-secret-not-used-for-anything-real-0123456789',
      trustedOrigins: ['https://acme.com', 'https://help.acme.com'],
      socialProviders: { github: { clientId: 'id', clientSecret: 'secret' } },
    })
    hoisted.signInSocial.mockImplementation((args: unknown) =>
      real.api.signInSocial(args as Parameters<typeof real.api.signInSocial>[0])
    )
    const response = await startSectionSignIn(
      get('acme.com', { provider: 'github', to: 'help.acme.com', returnTo: '/hc' })
    )
    expect(new URL(response.headers.get('location')!).host).toBe('github.com')
    expect(response.headers.getSetCookie().some((c) => c.includes('state'))).toBe(true)
  })

  it('runs only on the primary domain', async () => {
    const response = await startSectionSignIn(
      get('help.acme.com', { provider: 'github', to: 'help.acme.com', returnTo: '/' })
    )
    expect(hoisted.signInSocial).not.toHaveBeenCalled()
    expect(response.headers.get('location')).toBe('/')
  })

  it('lands on the error page of the section host, signed out, when the library refuses', async () => {
    hoisted.signInSocial.mockResolvedValue(new Response('{}', { status: 400 }))
    const response = await startSectionSignIn(
      get('acme.com', {
        provider: 'nope',
        to: 'help.acme.com',
        returnTo: '/hc',
        errorReturnTo: '/?auth=signin',
      })
    )
    expect(response.headers.get('location')).toBe('https://help.acme.com/?auth=signin')
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })
})
