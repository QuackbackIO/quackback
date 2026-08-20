/**
 * Tests for the SSO/domain-related guard rails:
 *
 *  - clearSsoClientSecretFn refuses while domain.verifiedAt != null
 *    (codex-flagged C2 from the design review — same pattern as the
 *    pre-existing enforced=true refusal).
 *
 *  - lookupAuthMethodsFn returns the same shape regardless of whether
 *    an account exists at the supplied email (no enumeration vector).
 *
 * Uses the `createServerFn` capture pattern from the sibling suites, with the
 * mocked `.handler(fn)` returning the handler itself so each server function is
 * reached by its own name. Indexing a positional array breaks silently the
 * moment a function is added above another in the file under test — it keeps
 * running, against the wrong handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthConfig } from '@/lib/server/domains/settings/settings.types'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: AnyHandler) => fn,
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockGetWorkspaceSettings: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockUpdateAuthConfig: vi.fn(),
  mockSetSsoDomainSubtree: vi.fn(),
  mockDeletePlatformCredentials: vi.fn(),
  mockHasSsoClientSecret: vi.fn(),
  mockGetTierLimits: vi.fn(),
  mockListIdentityProviders: vi.fn(),
  mockGetRegisteredOidcProviderIds: vi.fn(),
  mockGetConfiguredIntegrationTypes: vi.fn(),
  mockIsEmailConfigured: vi.fn().mockReturnValue(true),
  mockCheckUrlSafety: vi.fn().mockResolvedValue({ safe: true }),
  mockSafeFetch: vi.fn(),
  mockRequireSettings: vi.fn(),
  mockInvalidateSettingsCache: vi.fn(),
  mockBumpAuthConfigVersionInTx: vi.fn(),
  mockResetAuth: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockHasActiveRecoveryCodes: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

const mockSetVerifiedDomainEnforced = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
  updateAuthConfig: hoisted.mockUpdateAuthConfig,
  setSsoDomainSubtree: hoisted.mockSetSsoDomainSubtree,
  setVerifiedDomainEnforced: mockSetVerifiedDomainEnforced,
  // Enforcement stamps the domain's verification alongside the flag, so the
  // mock has to expose it or every enforcement path throws on a missing export.
  stampVerifiedDomain: vi.fn(async () => undefined),
}))

vi.mock('@/lib/server/auth/sso-secret', () => ({
  hasSsoClientSecret: hoisted.mockHasSsoClientSecret,
  SSO_CREDENTIAL_TYPE: 'auth_sso',
  // Stub mirrors the production logic so tests can drive drift cases
  // through the same `mockHasSsoClientSecret` / `mockGetTierLimits`
  // they already toggle for the underlying conditions.
  isSsoActuallyRegistered: async (
    sso: { enabled?: boolean } | undefined,
    tierLimits: { features: { customOidcProvider?: boolean } }
  ) => {
    if (!sso?.enabled) return false
    if (!tierLimits.features.customOidcProvider) return false
    return hoisted.mockHasSsoClientSecret()
  },
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  deletePlatformCredentials: hoisted.mockDeletePlatformCredentials,
  getConfiguredIntegrationTypes: hoisted.mockGetConfiguredIntegrationTypes,
}))

// Task 13: lookupAuthMethodsFn now routes via the identity-provider registry
// (listIdentityProviders) and the canonical registration gate
// (getRegisteredOidcProviderIds), instead of reading authConfig.ssoOidc +
// verifiedDomains directly. The mocks below synthesize a single 'sso' provider
// from the same getWorkspaceSettings / tier / secret knobs the tests already
// toggle, so the migrated single-provider scenarios stay green.
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: hoisted.mockListIdentityProviders,
}))

vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: hoisted.mockGetRegisteredOidcProviderIds,
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: hoisted.mockIsEmailConfigured,
}))

// Keep the real module (notably `SsrfError`, so the `instanceof`
// branch in testSsoConnectionFn resolves) and override only the two
// functions the SSO code calls: the discovery fetch (`safeFetch`) and
// the per-sub-endpoint check (`checkUrlSafety`).
vi.mock('@/lib/server/content/ssrf-guard', async (orig) => {
  const actual = await orig<typeof import('@/lib/server/content/ssrf-guard')>()
  return {
    ...actual,
    checkUrlSafety: hoisted.mockCheckUrlSafety,
    safeFetch: hoisted.mockSafeFetch,
  }
})

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  requireSettings: hoisted.mockRequireSettings,
  invalidateSettingsCache: hoisted.mockInvalidateSettingsCache,
  parseJsonConfig: (json: string | null, def: unknown) => (json ? JSON.parse(json) : def),
}))

vi.mock('@/lib/server/auth/config-version', () => ({
  bumpAuthConfigVersionInTx: hoisted.mockBumpAuthConfigVersionInTx,
}))

vi.mock('@/lib/server/auth', () => ({
  resetAuth: hoisted.mockResetAuth,
}))

vi.mock('@/lib/server/auth/recovery-codes-status', () => ({
  hasActiveRecoveryCodes: hoisted.mockHasActiveRecoveryCodes,
}))

// Spread the real db module so tables/operators stay current; override only what this suite drives.
vi.mock('@/lib/server/db', async (importOriginal) => {
  const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  const updateMock = vi.fn().mockReturnValue({ set: setMock })
  const txMock = { update: updateMock }
  hoisted.mockDbUpdate.mockImplementation(updateMock)
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      transaction: async (fn: (tx: typeof txMock) => Promise<void>) => {
        hoisted.mockDbTransaction()
        await fn(txMock)
      },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val, _kind: 'eq' })),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(),
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
  withAuditEvent: async (
    _spec: { event: string; metadata?: Record<string, unknown>; [k: string]: unknown },
    fn: () => Promise<unknown>
  ) => fn(),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: 'user_1' },
    principal: { id: 'principal_1', role: 'admin' },
  })
  // Defaults: SSO is fully registered; recovery codes present. Drift-specific cases override.
  hoisted.mockHasSsoClientSecret.mockResolvedValue(true)
  hoisted.mockHasActiveRecoveryCodes.mockResolvedValue(true)
  hoisted.mockGetTierLimits.mockResolvedValue({
    features: { customOidcProvider: true },
  })

  // Synthesize the 'sso' provider + its registration/creds snapshot from the
  // workspace/tier/secret knobs each test sets, mirroring how the real registry
  // would derive them for a single migrated 'sso' provider.
  hoisted.mockListIdentityProviders.mockImplementation(async () => {
    const workspace = await hoisted.mockGetWorkspaceSettings()
    const sso = workspace?.authConfig?.ssoOidc
    if (!sso) return []
    return [
      {
        id: 'idp_sso',
        registrationId: 'sso',
        enabled: sso.enabled === true,
        autoCreateUsers: sso.autoCreateUsers ?? true,
        autoProvisionRole: sso.autoProvisionRole ?? null,
        claimMapping: sso.attributeMapping ? { role: sso.attributeMapping } : null,
        domains: workspace?.verifiedDomains ?? [],
      },
    ]
  })
  hoisted.mockGetRegisteredOidcProviderIds.mockImplementation(async () => {
    const workspace = await hoisted.mockGetWorkspaceSettings()
    const sso = workspace?.authConfig?.ssoOidc
    const tier = await hoisted.mockGetTierLimits()
    const ids = new Set<string>()
    if (!tier?.features?.customOidcProvider) return ids
    if (sso?.enabled !== true) return ids
    if (!(await hoisted.mockHasSsoClientSecret())) return ids
    ids.add('sso')
    return ids
  })
  hoisted.mockGetConfiguredIntegrationTypes.mockImplementation(async () => {
    const has = await hoisted.mockHasSsoClientSecret()
    return new Set<string>(has ? ['auth_sso'] : [])
  })
})

const ssoConfig: AuthConfig['ssoOidc'] = {
  enabled: true,
  discoveryUrl: 'https://acme.idp/.well-known/openid-configuration',
  clientId: 'client',
  autoCreateUsers: true,
}

const verifiedDomainRow = {
  id: 'domain_acme' as `domain_${string}`,
  name: 'acme.com',
  verificationToken: 'tok',
  verifiedAt: '2026-05-10T00:00:00.000Z',
  enforced: false,
  createdAt: '2026-05-10T00:00:00.000Z',
}

const enforcedDomainRow = { ...verifiedDomainRow, enforced: true }

// Under the mock above each export IS its handler, so these are the real
// functions by name and stay correct however the files are reordered.
const { clearSsoClientSecretFn, setDomainEnforcedFn } = await import('../sso')
const { lookupAuthMethodsFn } = await import('../auth')

const clearSsoClientSecret = clearSsoClientSecretFn as unknown as AnyHandler
const setDomainEnforced = setDomainEnforcedFn as unknown as AnyHandler
const lookupAuthMethods = lookupAuthMethodsFn as unknown as AnyHandler

describe('clearSsoClientSecretFn refusals', () => {
  it('refuses when any verified domain has enforcement on', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [enforcedDomainRow],
    })

    await expect(clearSsoClientSecret({ data: {} })).rejects.toThrow(/enforcement/i)
    expect(hoisted.mockDeletePlatformCredentials).not.toHaveBeenCalled()
  })

  it('refuses when a domain is verified (even without enforcement)', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [verifiedDomainRow],
    })

    await expect(clearSsoClientSecret({ data: {} })).rejects.toThrow(/verified domain/i)
    expect(hoisted.mockDeletePlatformCredentials).not.toHaveBeenCalled()
  })

  it('allows clearing when no verified-domain rows exist', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [],
    })

    await expect(clearSsoClientSecret({ data: {} })).resolves.toEqual({ success: true })
    expect(hoisted.mockDeletePlatformCredentials).toHaveBeenCalledTimes(1)
  })

  it('allows clearing when only pending (unverified) domain rows exist', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [{ ...verifiedDomainRow, verifiedAt: null }],
    })

    await expect(clearSsoClientSecret({ data: {} })).resolves.toEqual({ success: true })
    expect(hoisted.mockDeletePlatformCredentials).toHaveBeenCalledTimes(1)
  })
})

describe('lookupAuthMethodsFn — no enumeration leak', () => {
  it('returns sso-redirect for verified-domain email when that domain row is enforced', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [enforcedDomainRow],
      publicAuthConfig: { oauth: { password: false, google: true } },
    })

    const result = await lookupAuthMethods({ data: { email: 'foo@acme.com' } })
    expect(result).toEqual({ kind: 'sso-redirect', providerId: 'sso' })
  })

  it('returns sso-default for verified-domain email when that domain row is not enforced', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [verifiedDomainRow],
      publicAuthConfig: { oauth: { password: false, google: true } },
    })

    const result = await lookupAuthMethods({ data: { email: 'foo@acme.com' } })
    expect(result).toEqual({
      kind: 'sso-default',
      providerId: 'sso',
      authConfig: { password: false, google: true },
    })
  })

  it('returns methods for non-verified-domain email', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [verifiedDomainRow],
      publicAuthConfig: { oauth: { password: false, google: true } },
    })

    const result = (await lookupAuthMethods({
      data: { email: 'foo@example.com' },
    })) as { kind: string }
    expect(result.kind).toBe('methods')
  })

  it('returns identical shape for known-vs-unknown emails (no enumeration)', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [verifiedDomainRow],
      publicAuthConfig: { oauth: { password: true } },
    })

    const a = await lookupAuthMethods({ data: { email: 'known@example.com' } })
    const b = await lookupAuthMethods({ data: { email: 'unknown@example.com' } })
    expect(a).toEqual(b)
  })
})

describe('lookupAuthMethodsFn — SSO registration drift', () => {
  // The owning provider's liveness gate (`enabled && registered &&
  // credsPresent`) decides routing. When the tier flag is off or the secret
  // is missing, the provider isn't registered, so routing falls THROUGH to
  // the methods form rather than dead-redirecting (or showing
  // "sso-unavailable"). This matches `isHardBound`, which fails open — scoped
  // to the owner — so password/magic-link stay usable when the IdP is dead.
  it('falls through to methods when tier flag is off (downgrade scenario)', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue({
      features: { customOidcProvider: false },
    })
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [verifiedDomainRow],
      publicAuthConfig: { oauth: { password: false } },
    })

    const result = await lookupAuthMethods({ data: { email: 'foo@acme.com' } })
    expect(result).toEqual({
      kind: 'methods',
      authConfig: { password: false },
      ssoEnabled: false,
    })
  })

  it('falls through to methods when client secret is missing', async () => {
    hoisted.mockHasSsoClientSecret.mockResolvedValue(false)
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [verifiedDomainRow],
      publicAuthConfig: { oauth: { password: false } },
    })

    const result = await lookupAuthMethods({ data: { email: 'foo@acme.com' } })
    expect(result).toEqual({
      kind: 'methods',
      authConfig: { password: false },
      ssoEnabled: false,
    })
  })

  it('still returns sso-redirect when all preconditions hold (enforced row)', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { ssoOidc: ssoConfig },
      verifiedDomains: [enforcedDomainRow],
      publicAuthConfig: { oauth: { password: false } },
    })

    const result = await lookupAuthMethods({ data: { email: 'foo@acme.com' } })
    expect(result).toEqual({ kind: 'sso-redirect', providerId: 'sso' })
  })
})

describe('lookupAuthMethodsFn — SSO deliberately disabled with stale verified-domain rows', () => {
  // Common real-world state: admin configured SSO + verified a domain,
  // then later flipped `ssoOidc.enabled` off (perhaps switching IdPs,
  // pausing rollout, or simplifying the login form). The verified-
  // domain row outlives the toggle. The lookup must fall through to
  // the methods form — showing "Single sign-on is configured but not
  // available" implies the admin needs to fix something, which is
  // wrong when they deliberately disabled it.
  it('falls through to methods (not sso-unavailable) when ssoOidc.enabled=false and a verified-domain row exists', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: {
        ssoOidc: { ...ssoConfig, enabled: false },
      },
      verifiedDomains: [verifiedDomainRow],
      publicAuthConfig: { oauth: { password: true, magicLink: true } },
    })

    const result = await lookupAuthMethods({ data: { email: 'foo@acme.com' } })
    expect(result).toEqual({
      kind: 'methods',
      authConfig: { password: true, magicLink: true },
      ssoEnabled: false,
    })
  })

  it('falls through to methods even when the stale verified-domain row was enforced=true', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: {
        ssoOidc: { ...ssoConfig, enabled: false },
      },
      verifiedDomains: [enforcedDomainRow],
      publicAuthConfig: { oauth: { password: true } },
    })

    const result = await lookupAuthMethods({ data: { email: 'foo@acme.com' } })
    expect(result).toMatchObject({ kind: 'methods', ssoEnabled: false })
  })

  it('falls through to methods when ssoOidc is entirely absent (never configured)', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: {},
      verifiedDomains: [verifiedDomainRow],
      publicAuthConfig: { oauth: { password: true } },
    })

    const result = await lookupAuthMethods({ data: { email: 'foo@acme.com' } })
    expect(result).toMatchObject({ kind: 'methods', ssoEnabled: false })
  })
})

describe('lookupAuthMethodsFn — team magic-link toggle', () => {
  it('returns publicAuthConfig.oauth.magicLink=false when admin disabled the toggle', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { oauth: { password: true, magicLink: false } },
      verifiedDomains: [],
      publicAuthConfig: { oauth: { password: true, magicLink: false } },
    })

    const result = await lookupAuthMethods({
      data: { email: 'a@external.com' },
    })
    expect(result).toEqual({
      kind: 'methods',
      authConfig: { password: true, magicLink: false },
      ssoEnabled: false,
    })
  })

  it('defaults publicAuthConfig.oauth.magicLink=true when key is absent (pre-0.12 workspaces)', async () => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: { oauth: { password: true } },
      verifiedDomains: [],
      publicAuthConfig: { oauth: { password: true, magicLink: true } },
    })

    const result = await lookupAuthMethods({
      data: { email: 'a@external.com' },
    })
    expect(result).toMatchObject({ authConfig: { magicLink: true } })
  })
})

describe('lookupAuthMethodsFn — ssoOidc.required is inert (workspace-wide mode removed)', () => {
  it('ignores ssoOidc.required in the unified sign-in config (workspace-wide mode removed)', async () => {
    // The `required` flag is inert; team users at non-verified-domain
    // emails should fall through to the methods form, not `sso-redirect`.
    hoisted.mockGetWorkspaceSettings.mockResolvedValue({
      authConfig: {
        oauth: { password: true },
        openSignup: false,
        ssoOidc: {
          enabled: true,
          discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
          clientId: 'cid',
          autoCreateUsers: false,
          required: true, // inert
        },
      },
      verifiedDomains: [],
      publicAuthConfig: { oauth: { password: true } },
    })

    const result = await lookupAuthMethods({
      data: { email: 'newhire@example.com' },
    })
    expect((result as { kind: string }).kind).toBe('methods')
  })
})

describe('setDomainEnforcedFn — recovery-code guard', () => {
  // A provider with lastSuccessfulTestAt > detailsChangedAt so that
  // isSsoEnforcementUnlocked (pure function, not mocked) returns true,
  // letting us drive the hasActiveRecoveryCodes check in isolation.
  const domainId = 'domain_acme' as `domain_${string}`
  const testProvider = {
    id: 'idp_sso',
    lastSuccessfulTestAt: '2026-01-02T00:00:00Z',
    detailsChangedAt: '2026-01-01T00:00:00Z',
    domains: [{ id: domainId, enforced: false }],
  }

  beforeEach(() => {
    hoisted.mockListIdentityProviders.mockResolvedValue([testProvider])
    mockSetVerifiedDomainEnforced.mockResolvedValue(undefined)
  })

  it('throws recovery_codes_required when no active recovery codes exist', async () => {
    hoisted.mockHasActiveRecoveryCodes.mockResolvedValue(false)

    await expect(setDomainEnforced({ data: { id: domainId, enforced: true } })).rejects.toThrow(
      'recovery_codes_required'
    )
    expect(mockSetVerifiedDomainEnforced).not.toHaveBeenCalled()
  })

  it('allows enabling enforcement and does not throw on the recovery-code check when codes exist', async () => {
    hoisted.mockHasActiveRecoveryCodes.mockResolvedValue(true)

    await expect(
      setDomainEnforced({ data: { id: domainId, enforced: true } })
    ).resolves.not.toThrow()
    expect(mockSetVerifiedDomainEnforced).toHaveBeenCalledWith(domainId, true)
  })

  it('skips the recovery-code check entirely when disabling enforcement', async () => {
    hoisted.mockHasActiveRecoveryCodes.mockResolvedValue(false)

    await expect(
      setDomainEnforced({ data: { id: domainId, enforced: false } })
    ).resolves.not.toThrow()
    expect(hoisted.mockHasActiveRecoveryCodes).not.toHaveBeenCalled()
  })

  it('allows enforcement without email delivery — recovery codes, not magic link, are the break-glass', async () => {
    // Magic-link/password are hard-bound off for enforced-domain emails, so
    // email delivery is NOT the break-glass; recovery codes are. Enforcement
    // must not be gated on SMTP/Resend being configured.
    hoisted.mockHasActiveRecoveryCodes.mockResolvedValue(true)
    hoisted.mockIsEmailConfigured.mockReturnValue(false)

    await expect(
      setDomainEnforced({ data: { id: domainId, enforced: true } })
    ).resolves.not.toThrow()
    expect(mockSetVerifiedDomainEnforced).toHaveBeenCalledWith(domainId, true)
  })
})
