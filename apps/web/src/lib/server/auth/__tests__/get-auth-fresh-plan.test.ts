/**
 * An auth rebuild reads the plan afresh.
 *
 * Plan limits are held in each process for a few seconds, and a plan change
 * written by another process reaches this one through the auth config version.
 * The rebuild that version triggers decides, once, whether identity providers
 * register, and the instance keeps that answer until the next version change.
 * So the rebuild must not take the plan from this process's copy: a copy read
 * just before the change would build an instance on the old plan and keep it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth: vi.fn(() => ({ api: {}, handler: vi.fn() })),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => null),
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

// Plan limits as the real service holds them: read from the database once,
// then served from this process's copy until it is dropped.
const plan = { stored: false, copy: undefined as boolean | undefined }
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => {
    if (plan.copy === undefined) plan.copy = plan.stored
    return { features: { customOidcProvider: plan.copy } }
  },
  invalidateTierLimitsCache: () => {
    plan.copy = undefined
  },
}))

const builtWith: boolean[] = []
vi.mock('../build-oauth-configs', () => ({
  buildGenericOAuthConfigs: async (opts: { tierAllowsOidc: boolean }) => {
    builtWith.push(opts.tierAllowsOidc)
    return []
  },
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: async () => [],
  getIdentityProviderCredentials: async () => null,
}))
vi.mock('../ensure-mcp-oauth-resource', () => ({
  ensureMcpOauthResource: vi.fn(async () => undefined),
}))
vi.mock('../hooks', () => ({ hooksBefore: vi.fn(), hooksAfter: vi.fn() }))

const { getAuth, resetAuth } = await import('../index')

beforeEach(() => {
  resetAuth()
  authConfigVersion = 1
  plan.stored = false
  plan.copy = undefined
  builtWith.length = 0
})

describe('auth rebuild', () => {
  it('registers providers on the plan written by another process', async () => {
    await getAuth()
    expect(builtWith).toEqual([false])

    // Another process applies a plan that includes single sign-on and moves
    // the version. This process still holds its copy of the old plan.
    plan.stored = true
    authConfigVersion = 2
    await getAuth()

    expect(builtWith).toEqual([false, true])
  })
})
