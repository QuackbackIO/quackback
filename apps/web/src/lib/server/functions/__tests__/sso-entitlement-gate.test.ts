/**
 * Plan gate on identity-provider upsert, and the exact width of its carve-out.
 *
 * The gate started life as `data.enabled !== false`, whose comment claimed it
 * existed "so a downgraded workspace can always take one out of service". It
 * was wider than that: sending `enabled: false` on a *new* provider created it
 * outright — full connection details persisted, `idp.created` emitted — with no
 * entitlement. Not a security hole (`features.customOidcProvider` independently
 * gates runtime registration) but a real hole in the commercial gate, and the
 * only hand-rolled conditional in the feature.
 *
 * The carve-out is now exactly one shape: a currently-enabled provider being
 * switched off. Every case below is driven through the real server function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      // Return the handler itself so each fn is reached by its own export name;
      // indexing a positional array breaks silently when a sibling is added.
      handler: (fn: AnyHandler) => fn,
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const hoisted = vi.hoisted(() => ({
  mockGetWorkspaceSettings: vi.fn(),
  mockListIdentityProviders: vi.fn(),
  mockUpsertIdentityProvider: vi.fn(),
  mockCheckIsOnlyWorkingSignInMethod: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 'user_1', email: 'admin@example.com' },
    principal: { id: 'principal_1', role: 'admin' },
  })),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: hoisted.mockListIdentityProviders,
  upsertIdentityProvider: hoisted.mockUpsertIdentityProvider,
}))

vi.mock('@/lib/server/auth/sign-in-method-availability', () => ({
  checkIsOnlyWorkingSignInMethod: hoisted.mockCheckIsOnlyWorkingSignInMethod,
}))

vi.mock('@/lib/server/audit/log', () => ({
  actorFromAuth: () => ({ userId: 'user_1' }),
  withAuditEvent: async (_event: unknown, fn: () => Promise<unknown>) => fn(),
}))

vi.mock('@/lib/server/auth/idp-audit-diff', () => ({
  diffProviderAudit: () => ({ before: {}, after: {} }),
}))

const { upsertIdentityProviderFn } = await import('../sso')
const upsert = upsertIdentityProviderFn as unknown as AnyHandler

/** A cloud-enabled workspace on a plan that does NOT include SSO. */
function onFreePlan() {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({
    settings: { id: 'ws_1', cloud: storedCloud('free') },
  })
}

const NEW_PROVIDER = {
  registrationId: 'oidc_x',
  label: 'Corp',
  clientId: 'abc',
  discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
}

const enabledPrior = {
  id: 'identity_provider_1',
  registrationId: 'oidc_x',
  enabled: true,
  configured: true,
}

const disabledPrior = { ...enabledPrior, enabled: false }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockListIdentityProviders.mockResolvedValue([])
  hoisted.mockUpsertIdentityProvider.mockImplementation(async (data: unknown) => data)
  hoisted.mockCheckIsOnlyWorkingSignInMethod.mockResolvedValue(false)
})

describe('unconfigured install', () => {
  it.each([
    ['no cloud config', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('creates a provider freely with %s', async (_label, cloud) => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
    await expect(upsert({ data: { ...NEW_PROVIDER, enabled: true } })).resolves.toBeDefined()
    expect(hoisted.mockUpsertIdentityProvider).toHaveBeenCalledOnce()
  })
})

describe('plan gate on a workspace without the SSO entitlement', () => {
  beforeEach(onFreePlan)

  it('refuses creating an enabled provider', async () => {
    await expect(upsert({ data: { ...NEW_PROVIDER, enabled: true } })).rejects.toBeInstanceOf(
      EntitlementRequiredError
    )
    expect(hoisted.mockUpsertIdentityProvider).not.toHaveBeenCalled()
  })

  it('refuses creating a provider sent as enabled:false — the bypass', async () => {
    // The exact input that previously returned 200, persisted the row and
    // emitted idp.created.
    await expect(upsert({ data: { ...NEW_PROVIDER, enabled: false } })).rejects.toBeInstanceOf(
      EntitlementRequiredError
    )
    expect(hoisted.mockUpsertIdentityProvider).not.toHaveBeenCalled()
  })

  it('refuses reconfiguring an already-disabled provider', async () => {
    // Editing a disabled provider is a reconfiguration, not a
    // take-out-of-service, so the carve-out must not cover it.
    hoisted.mockListIdentityProviders.mockResolvedValue([disabledPrior])
    await expect(
      upsert({ data: { ...NEW_PROVIDER, id: disabledPrior.id, enabled: false } })
    ).rejects.toBeInstanceOf(EntitlementRequiredError)
    expect(hoisted.mockUpsertIdentityProvider).not.toHaveBeenCalled()
  })

  it('refuses re-enabling a disabled provider', async () => {
    hoisted.mockListIdentityProviders.mockResolvedValue([disabledPrior])
    await expect(
      upsert({ data: { ...NEW_PROVIDER, id: disabledPrior.id, enabled: true } })
    ).rejects.toBeInstanceOf(EntitlementRequiredError)
  })

  it('names the plan in the refusal', async () => {
    let caught: EntitlementRequiredError | null = null
    try {
      await upsert({ data: { ...NEW_PROVIDER, enabled: true } })
    } catch (err) {
      caught = err as EntitlementRequiredError
    }
    expect(caught!.message).toBe(
      'Single sign-on is a Scale feature. Your workspace is on Free. Upgrade to Scale to enable it.'
    )
    expect(caught!.statusCode).toBe(402)
  })

  it('ALLOWS switching a currently-enabled provider off — the whole carve-out', async () => {
    hoisted.mockListIdentityProviders.mockResolvedValue([enabledPrior])
    await expect(
      upsert({ data: { ...NEW_PROVIDER, id: enabledPrior.id, enabled: false } })
    ).resolves.toBeDefined()
    expect(hoisted.mockUpsertIdentityProvider).toHaveBeenCalledOnce()
  })

  it('still applies the lockout guard on that carve-out path', async () => {
    // The gate must not have displaced the last-sign-in-method check by
    // running before `prior` was resolved.
    hoisted.mockListIdentityProviders.mockResolvedValue([enabledPrior])
    hoisted.mockCheckIsOnlyWorkingSignInMethod.mockResolvedValue(true)
    await expect(
      upsert({ data: { ...NEW_PROVIDER, id: enabledPrior.id, enabled: false } })
    ).rejects.toThrow(/only enabled sign-in method/)
  })
})

describe('plan gate on a workspace that holds the entitlement', () => {
  it('allows creating a provider on Scale', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', cloud: { enabled: true, plan: 'scale' } },
    })
    await expect(upsert({ data: { ...NEW_PROVIDER, enabled: true } })).resolves.toBeDefined()
  })

  it('allows creating a provider on a grandfathered override', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      settings: { id: 'ws_1', cloud: { enabled: true, plan: 'pro', entitlements: { sso: true } } },
    })
    await expect(upsert({ data: { ...NEW_PROVIDER, enabled: true } })).resolves.toBeDefined()
  })
})
