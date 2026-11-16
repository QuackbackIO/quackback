// @vitest-environment node
/**
 * A sign-in email asked for on a section host (help.acme.com) signs in there:
 * the link goes to that host, so the session cookie lands on it. Any other
 * host, and any host only a forwarded header names, gets the primary domain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  requestEmailSignin: vi.fn(async (_opts: unknown) => undefined),
}))

vi.mock('@/lib/server/auth/email-signin', () => ({
  EmailSigninRefusedError: class extends Error {},
  requestEmailSignin: hoisted.requestEmailSignin,
}))
vi.mock('@/lib/server/auth/signin-rate-limit', () => ({
  checkMagicLinkSendRateLimit: async () => ({ allowed: true }),
}))
vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://acme.com' },
  getBaseUrl: () => 'https://acme.com',
}))
// The real section table, from settings that map the help center to its host.
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

const { handlePortalSignin } = await import('../portal-signin')

function post(host: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://${host}/api/auth/portal-signin`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email: 'jo@example.com', callbackURL: '/hc' }),
  })
}

function linkOrigin(): unknown {
  return (hoisted.requestEmailSignin.mock.calls[0]![0] as { linkOrigin?: string }).linkOrigin
}

beforeEach(() => hoisted.requestEmailSignin.mockClear())

describe('portal sign-in email on a section host', () => {
  it('links to the section host it was asked for on', async () => {
    expect((await handlePortalSignin(post('help.acme.com'))).status).toBe(200)
    expect(linkOrigin()).toBe('https://help.acme.com')
  })

  it('links to the primary domain when asked for there', async () => {
    await handlePortalSignin(post('acme.com'))
    expect(linkOrigin()).toBeUndefined()
  })

  it('links to the primary domain for a host that is not a section host of this workspace', async () => {
    await handlePortalSignin(post('evil.example'))
    expect(linkOrigin()).toBeUndefined()
  })

  it('ignores a forwarded host naming the section host', async () => {
    await handlePortalSignin(post('acme.com', { 'x-forwarded-host': 'help.acme.com' }))
    expect(linkOrigin()).toBeUndefined()
  })
})
