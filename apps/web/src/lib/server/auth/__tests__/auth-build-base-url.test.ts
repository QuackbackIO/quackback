/**
 * The auth instance is cached past the request that builds it, so it is built
 * from the workspace's configured origin, never from a per-request override
 * (a custom domain paused after the plan limits grace). Otherwise a paused
 * request would bake the default host into OAuth callbacks, the MCP resource
 * and its stored `oauth_resource` row, and keep it after an upgrade.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.BASE_URL = 'https://feedback.acme.test'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

const { built, ensured } = vi.hoisted(() => ({
  built: { options: null as null | { baseURL?: string } },
  ensured: [] as string[],
}))

vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth: vi.fn((options: { baseURL?: string }) => {
    built.options = options
    return { api: {}, handler: vi.fn() }
  }),
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
  ensureMcpOauthResource: vi.fn(async ({ identifier }: { identifier: string }) => {
    ensured.push(identifier)
  }),
}))
vi.mock('../hooks', () => ({ hooksBefore: vi.fn(), hooksAfter: vi.fn() }))

const { getAuth, resetAuth } = await import('../index')
const { runWithLogContext } = await import('@/lib/server/log-context')
const { setRequestBaseUrlOverride } = await import('@/lib/server/base-url-override')
const { resetConfig } = await import('@/lib/server/config')

beforeEach(() => {
  resetConfig()
  resetAuth()
  built.options = null
  ensured.length = 0
})

describe('building the auth instance during a paused custom domain request', () => {
  it('uses the configured origin, not the request override', async () => {
    await runWithLogContext({} as never, async () => {
      setRequestBaseUrlOverride('https://acme.example.com')
      await getAuth()
    })
    expect(built.options?.baseURL).toBe('https://feedback.acme.test')
    expect(ensured.length).toBeGreaterThan(0)
    expect(ensured.every((id) => id.startsWith('https://feedback.acme.test/'))).toBe(true)
  })
})
