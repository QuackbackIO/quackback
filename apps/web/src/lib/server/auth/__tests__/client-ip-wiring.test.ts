/**
 * Every way into Better Auth carries the trusted client address: the instance
 * is configured to read only the private header, requests through
 * `auth.handler` get it set from the socket peer, and server-side `auth.api.*`
 * calls get the same rewrite of the headers they forward.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

const { built, mockGetRequestIP } = vi.hoisted(() => ({
  built: {
    options: null as null | { advanced?: { ipAddress?: unknown } },
    handler: vi.fn(async (_request: Request) => new Response(null, { status: 204 })),
    getSession: vi.fn(async (_args: { headers: Headers }) => null),
  },
  mockGetRequestIP: vi.fn(),
}))

vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth: vi.fn((options: typeof built.options) => {
    built.options = options
    return { api: { getSession: built.getSession }, handler: built.handler }
  }),
}))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestIP: mockGetRequestIP,
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => null),
  getConfiguredIntegrationTypes: vi.fn(async () => new Set()),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => ({
    settings: { authConfigVersion: 1 },
    authConfig: { oauth: {} },
    developerConfig: {},
  })),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ features: {} })),
}))
vi.mock('../ensure-mcp-oauth-resource', () => ({
  ensureMcpOauthResource: vi.fn(async () => undefined),
}))
vi.mock('../hooks', () => ({
  hooksBefore: vi.fn(),
  hooksAfter: vi.fn(),
}))

const { auth, getAuth, resetAuth } = await import('../index')
const { CLIENT_IP_HEADER, betterAuthIpAddressOptions } = await import('../client-ip')

beforeEach(() => {
  resetAuth()
  built.handler.mockClear()
  built.getSession.mockClear()
  mockGetRequestIP.mockReset()
  mockGetRequestIP.mockReturnValue('203.0.113.41')
})

describe('Better Auth client address wiring', () => {
  it('configures the instance to read only the private header', async () => {
    await getAuth()
    expect(built.options?.advanced?.ipAddress).toEqual(betterAuthIpAddressOptions)
  })

  it('hands the handler the socket peer, whatever the client sent', async () => {
    await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'x-forwarded-for': '9.9.9.9', [CLIENT_IP_HEADER]: '9.9.9.9' },
        body: '{}',
      })
    )
    const seen = built.handler.mock.calls[0]?.[0]
    expect(seen?.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.41')
  })

  it('rewrites the headers forwarded by a server-side api call', async () => {
    await auth.api.getSession({ headers: new Headers({ [CLIENT_IP_HEADER]: '9.9.9.9' }) })
    const seen = built.getSession.mock.calls[0]?.[0]
    expect(seen?.headers.get(CLIENT_IP_HEADER)).toBe('203.0.113.41')
  })
})
