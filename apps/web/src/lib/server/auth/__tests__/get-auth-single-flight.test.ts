/**
 * A cold auth instance is built once, however many requests ask for it.
 *
 * The first page after a boot (or after an auth config change) fans out into
 * several server-function requests at once, and every one of them needs the
 * auth instance. Each used to build its own: load every provider's platform
 * credentials, list the identity providers and register the plugins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

let builds = 0
vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth: vi.fn(() => ({ id: ++builds, api: {}, handler: vi.fn() })),
}))

const mockGetPlatformCredentials = vi.fn(async (_type: string) => {
  // Long enough for every concurrent caller to arrive while the build runs.
  await new Promise((resolve) => setTimeout(resolve, 20))
  return null
})
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: (type: string) => mockGetPlatformCredentials(type),
  getConfiguredIntegrationTypes: vi.fn(async () => new Set()),
}))

let authConfigVersion = 1
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => ({
    settings: { authConfigVersion },
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

const { getAuth, resetAuth } = await import('../index')
const { getAllAuthProviders } = await import('../auth-providers')
const socialProviders = getAllAuthProviders().filter((p) => p.type !== 'generic-oauth').length

beforeEach(() => {
  resetAuth()
  builds = 0
  authConfigVersion = 1
  mockGetPlatformCredentials.mockClear()
})

describe('getAuth', () => {
  it('builds a cold instance once for concurrent callers', async () => {
    const instances = await Promise.all(Array.from({ length: 6 }, () => getAuth()))

    expect(new Set(instances).size).toBe(1)
    expect(builds).toBe(1)
    expect(mockGetPlatformCredentials).toHaveBeenCalledTimes(socialProviders)
  })

  it('reuses the built instance until the auth config changes', async () => {
    const first = await getAuth()
    expect(await getAuth()).toBe(first)

    authConfigVersion = 2
    const rebuilt = await getAuth()

    expect(rebuilt).not.toBe(first)
    expect(await getAuth()).toBe(rebuilt)
    expect(builds).toBe(2)
  })

  it('starts afresh after a reset, even with a build still in flight', async () => {
    const stale = getAuth()
    resetAuth()
    const fresh = await getAuth()
    await stale

    expect(builds).toBe(2)
    expect(await getAuth()).toBe(fresh)
  })

  it('does not keep a failed build', async () => {
    mockGetPlatformCredentials.mockRejectedValueOnce(new Error('credential store down'))

    await expect(getAuth()).rejects.toThrow('credential store down')
    await expect(getAuth()).resolves.toBeDefined()
  })
})
