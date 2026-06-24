/**
 * Focused unit tests for the `upsertIdentityProvider` write path.
 *
 * Covers Fix 5 (SSRF guard) and Fix 6 (detailsChangedAt restamp) from
 * the Codex IdP-cluster review.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'

// ---------------------------------------------------------------------------
// Hoisted state
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  mockCheckUrlSafety: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockHasPlatformCredentials: vi.fn(),
  mockResetAuth: vi.fn(),
  mockInvalidateSettingsCache: vi.fn(),
  mockBumpAuthConfigVersionInTx: vi.fn(),
  // Mutable ref: what the tx select() returns. Empty = INSERT path;
  // populate with [EXISTING_ROW] to exercise the UPDATE/edit path.
  txSelectResult: [] as object[],
  // Mutable ref: the patch passed to tx.update().set() on the last call.
  // Inspected by Fix 6 tests.
  capturedSetPatch: null as Record<string, unknown> | null,
}))

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/server/content/ssrf-guard', () => ({
  checkUrlSafety: hoisted.mockCheckUrlSafety,
}))

vi.mock('@/lib/server/auth/config-version', () => ({
  bumpAuthConfigVersionInTx: hoisted.mockBumpAuthConfigVersionInTx,
}))

vi.mock('@/lib/server/auth', () => ({
  resetAuth: hoisted.mockResetAuth,
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: hoisted.mockInvalidateSettingsCache,
  wrapDbError: (_msg: string, err: unknown) => {
    throw err
  },
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: hoisted.mockHasPlatformCredentials,
  getConfiguredIntegrationTypes: vi.fn().mockResolvedValue(new Set<string>()),
}))

vi.mock('@/lib/server/auth/auth-providers', () => ({
  AUTH_CREDENTIAL_PREFIX: 'auth_',
}))

vi.mock('@/lib/server/auth/provider-ids', () => ({
  verifiedDomainCount: () => 0,
  shouldRenderPublicButton: () => false,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) },
}))

// DB mock: transaction calls fn with a tx that supports select/update/insert.
// Domain table objects are stubs — the eq() filter arguments are ignored so
// the mock can return controlled results regardless of which column was filtered.
vi.mock('@/lib/server/db', () => ({
  db: {
    // Used by listDomainsForProvider (outside the tx, after commit).
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve([]),
        }),
      }),
    })),
    transaction: async (fn: (tx: object) => Promise<unknown>) => {
      hoisted.mockDbTransaction()
      const tx = {
        select: () => ({
          from: () => ({
            // Returns whatever txSelectResult holds at call time.
            where: () => Promise.resolve(hoisted.txSelectResult),
          }),
        }),
        update: () => ({
          set: (patch: Record<string, unknown>) => {
            hoisted.capturedSetPatch = patch
            const base = hoisted.txSelectResult[0] ?? {}
            return {
              where: () => ({
                returning: () => Promise.resolve([{ ...base, ...patch }]),
              }),
            }
          },
        }),
        insert: () => ({
          values: (vals: Record<string, unknown>) => ({
            returning: () =>
              Promise.resolve([
                {
                  ...vals,
                  id: 'idp_new',
                  detailsChangedAt: null,
                  lastSuccessfulTestAt: null,
                  createdAt: new Date('2026-01-01'),
                  kind: null,
                  authorizationUrl: null,
                  tokenUrl: null,
                  userInfoUrl: null,
                  attributeMapping: null,
                },
              ]),
          }),
        }),
      }
      return fn(tx)
    },
  },
  identityProvider: {},
  ssoVerifiedDomain: {},
  eq: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import subject AFTER mocks are wired
// ---------------------------------------------------------------------------

import { upsertIdentityProvider } from '../identity-providers.service'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_INPUT = {
  registrationId: 'oidc_x',
  label: 'Acme IdP',
  clientId: 'client-abc',
  discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
} as const

const EXISTING_ROW = {
  id: 'idp_existing' as `idp_${string}`,
  registrationId: 'oidc_x',
  label: 'Acme IdP',
  kind: null,
  discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
  authorizationUrl: null,
  tokenUrl: null,
  userInfoUrl: null,
  clientId: 'client-abc',
  scopes: null,
  enabled: false,
  autoCreateUsers: true,
  autoProvisionRole: null,
  attributeMapping: null,
  showButton: false,
  detailsChangedAt: null,
  lastSuccessfulTestAt: null,
  createdAt: new Date('2026-01-01'),
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.txSelectResult = []
  hoisted.capturedSetPatch = null
  hoisted.mockHasPlatformCredentials.mockResolvedValue(false)
  hoisted.mockInvalidateSettingsCache.mockResolvedValue(undefined)
  hoisted.mockBumpAuthConfigVersionInTx.mockResolvedValue(undefined)
  // Default: safe URL. Override in SSRF-rejection tests.
  hoisted.mockCheckUrlSafety.mockResolvedValue({ safe: true, address: '93.184.216.34', family: 4 })
})

// ---------------------------------------------------------------------------
// Fix 5: SSRF guard on discoveryUrl
// ---------------------------------------------------------------------------

describe('upsertIdentityProvider — SSRF guard (Fix 5)', () => {
  it('throws ValidationError INVALID_IDP_CONFIG with private-address message when ssrf-rejected', async () => {
    hoisted.mockCheckUrlSafety.mockResolvedValue({ safe: false, reason: 'ssrf-rejected' })

    await expect(upsertIdentityProvider(BASE_INPUT)).rejects.toBeInstanceOf(ValidationError)
    await expect(upsertIdentityProvider(BASE_INPUT)).rejects.toMatchObject({
      code: 'INVALID_IDP_CONFIG',
      message: expect.stringMatching(/private or loopback/i),
    })
  })

  it('throws ValidationError INVALID_IDP_CONFIG with https message when scheme-rejected', async () => {
    hoisted.mockCheckUrlSafety.mockResolvedValue({ safe: false, reason: 'scheme-rejected' })

    await expect(upsertIdentityProvider(BASE_INPUT)).rejects.toMatchObject({
      code: 'INVALID_IDP_CONFIG',
      message: expect.stringMatching(/https/i),
    })
  })

  it('aborts before db.transaction when discoveryUrl is unsafe', async () => {
    hoisted.mockCheckUrlSafety.mockResolvedValue({ safe: false, reason: 'ssrf-rejected' })

    await upsertIdentityProvider(BASE_INPUT).catch(() => {})

    expect(hoisted.mockDbTransaction).not.toHaveBeenCalled()
  })

  it('calls checkUrlSafety and proceeds when the URL is safe', async () => {
    hoisted.mockCheckUrlSafety.mockResolvedValue({
      safe: true,
      address: '93.184.216.34',
      family: 4,
    })

    await upsertIdentityProvider(BASE_INPUT)

    expect(hoisted.mockCheckUrlSafety).toHaveBeenCalledWith(BASE_INPUT.discoveryUrl)
    expect(hoisted.mockDbTransaction).toHaveBeenCalledTimes(1)
  })

  it('skips checkUrlSafety entirely when discoveryUrl is absent', async () => {
    const { discoveryUrl: _omit, ...inputWithoutUrl } = BASE_INPUT

    await upsertIdentityProvider(inputWithoutUrl)

    expect(hoisted.mockCheckUrlSafety).not.toHaveBeenCalled()
    expect(hoisted.mockDbTransaction).toHaveBeenCalledTimes(1)
  })

  it('skips checkUrlSafety when discoveryUrl is explicitly null', async () => {
    await upsertIdentityProvider({ ...BASE_INPUT, discoveryUrl: null })

    expect(hoisted.mockCheckUrlSafety).not.toHaveBeenCalled()
    expect(hoisted.mockDbTransaction).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Fix 6: restamp detailsChangedAt on connection-field edits
// ---------------------------------------------------------------------------

describe('upsertIdentityProvider — detailsChangedAt restamp (Fix 6)', () => {
  beforeEach(() => {
    // Use the UPDATE (edit) path: tx.select returns the existing row.
    hoisted.txSelectResult = [EXISTING_ROW]
  })

  it('restamps detailsChangedAt when clientId changes', async () => {
    const before = Date.now()

    await upsertIdentityProvider({
      ...BASE_INPUT,
      id: 'idp_existing' as `idp_${string}`,
      clientId: 'new-client-id', // changed from EXISTING_ROW.clientId
    })

    expect(hoisted.capturedSetPatch).not.toBeNull()
    expect(hoisted.capturedSetPatch!.detailsChangedAt).toBeInstanceOf(Date)
    expect((hoisted.capturedSetPatch!.detailsChangedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before
    )
  })

  it('restamps detailsChangedAt when discoveryUrl changes', async () => {
    const before = Date.now()

    await upsertIdentityProvider({
      ...BASE_INPUT,
      id: 'idp_existing' as `idp_${string}`,
      discoveryUrl: 'https://new-idp.example/.well-known/openid-configuration', // changed
    })

    expect(hoisted.capturedSetPatch!.detailsChangedAt).toBeInstanceOf(Date)
    expect((hoisted.capturedSetPatch!.detailsChangedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before
    )
  })

  it('does NOT restamp detailsChangedAt when only label changes (non-connection field)', async () => {
    await upsertIdentityProvider({
      ...BASE_INPUT,
      id: 'idp_existing' as `idp_${string}`,
      label: 'New Label Only', // non-connection field; clientId + discoveryUrl same as existing
    })

    expect(hoisted.capturedSetPatch).not.toBeNull()
    expect(hoisted.capturedSetPatch!.detailsChangedAt).toBeUndefined()
  })

  it('does NOT restamp when discoveryUrl is omitted (patch semantics, no change signal)', async () => {
    const { discoveryUrl: _omit, ...inputWithoutUrl } = BASE_INPUT

    await upsertIdentityProvider({
      ...inputWithoutUrl,
      id: 'idp_existing' as `idp_${string}`,
      // clientId same as EXISTING_ROW; discoveryUrl not supplied
    })

    expect(hoisted.capturedSetPatch!.detailsChangedAt).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Fix 7: the manual OIDC endpoints (authorizationUrl / tokenUrl / userInfoUrl)
// are server-fetched too, so they get the SAME SSRF guard + restamp treatment
// as discoveryUrl — a stale test must not vouch for a swapped token endpoint.
// ---------------------------------------------------------------------------

describe('upsertIdentityProvider — manual endpoint SSRF guard (Fix 7)', () => {
  it('throws when tokenUrl resolves to a private/loopback address', async () => {
    const TOKEN = 'https://token.internal/oauth/token'
    hoisted.mockCheckUrlSafety.mockImplementation(async (u: string) =>
      u === TOKEN
        ? { safe: false, reason: 'ssrf-rejected' }
        : { safe: true, address: '93.184.216.34', family: 4 }
    )

    await expect(upsertIdentityProvider({ ...BASE_INPUT, tokenUrl: TOKEN })).rejects.toMatchObject({
      code: 'INVALID_IDP_CONFIG',
      message: expect.stringMatching(/private or loopback/i),
    })
    expect(hoisted.mockCheckUrlSafety).toHaveBeenCalledWith(TOKEN)
  })

  it('throws when userInfoUrl resolves to a private/loopback address', async () => {
    const USERINFO = 'https://userinfo.internal/me'
    hoisted.mockCheckUrlSafety.mockImplementation(async (u: string) =>
      u === USERINFO
        ? { safe: false, reason: 'ssrf-rejected' }
        : { safe: true, address: '93.184.216.34', family: 4 }
    )

    await expect(
      upsertIdentityProvider({ ...BASE_INPUT, userInfoUrl: USERINFO })
    ).rejects.toMatchObject({ code: 'INVALID_IDP_CONFIG' })
    expect(hoisted.mockCheckUrlSafety).toHaveBeenCalledWith(USERINFO)
  })

  it('throws when authorizationUrl resolves to a private/loopback address', async () => {
    const AUTHZ = 'https://authorize.internal/authorize'
    hoisted.mockCheckUrlSafety.mockImplementation(async (u: string) =>
      u === AUTHZ
        ? { safe: false, reason: 'ssrf-rejected' }
        : { safe: true, address: '93.184.216.34', family: 4 }
    )

    await expect(
      upsertIdentityProvider({ ...BASE_INPUT, authorizationUrl: AUTHZ })
    ).rejects.toMatchObject({ code: 'INVALID_IDP_CONFIG' })
    expect(hoisted.mockCheckUrlSafety).toHaveBeenCalledWith(AUTHZ)
  })

  it('still proceeds when all provided endpoints are safe', async () => {
    await upsertIdentityProvider({
      ...BASE_INPUT,
      authorizationUrl: 'https://idp.example/authorize',
      tokenUrl: 'https://idp.example/token',
      userInfoUrl: 'https://idp.example/userinfo',
    })

    expect(hoisted.mockCheckUrlSafety).toHaveBeenCalledWith('https://idp.example/token')
    expect(hoisted.mockDbTransaction).toHaveBeenCalledTimes(1)
  })
})

describe('upsertIdentityProvider — manual endpoint restamp (Fix 7)', () => {
  beforeEach(() => {
    hoisted.txSelectResult = [EXISTING_ROW]
  })

  it('restamps detailsChangedAt when tokenUrl changes', async () => {
    const before = Date.now()

    await upsertIdentityProvider({
      ...BASE_INPUT,
      id: 'idp_existing' as `idp_${string}`,
      tokenUrl: 'https://idp.example/oauth/token', // EXISTING_ROW.tokenUrl is null
    })

    expect(hoisted.capturedSetPatch!.detailsChangedAt).toBeInstanceOf(Date)
    expect((hoisted.capturedSetPatch!.detailsChangedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before
    )
  })

  it('restamps detailsChangedAt when authorizationUrl changes', async () => {
    const before = Date.now()

    await upsertIdentityProvider({
      ...BASE_INPUT,
      id: 'idp_existing' as `idp_${string}`,
      authorizationUrl: 'https://idp.example/authorize', // EXISTING_ROW.authorizationUrl is null
    })

    expect(hoisted.capturedSetPatch!.detailsChangedAt).toBeInstanceOf(Date)
    expect((hoisted.capturedSetPatch!.detailsChangedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before
    )
  })

  it('restamps detailsChangedAt when userInfoUrl changes', async () => {
    const before = Date.now()

    await upsertIdentityProvider({
      ...BASE_INPUT,
      id: 'idp_existing' as `idp_${string}`,
      userInfoUrl: 'https://idp.example/userinfo', // EXISTING_ROW.userInfoUrl is null
    })

    expect(hoisted.capturedSetPatch!.detailsChangedAt).toBeInstanceOf(Date)
    expect((hoisted.capturedSetPatch!.detailsChangedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before
    )
  })
})

// ---------------------------------------------------------------------------
// Fix 8: an enabled provider must have a usable OAuth endpoint source
// (discovery URL, or both authorization + token URLs). Otherwise
// buildGenericOAuthConfigs publishes a config with nowhere to send users.
// ---------------------------------------------------------------------------

describe('upsertIdentityProvider — enable requires OAuth endpoints (Fix 8)', () => {
  it('throws when creating an enabled provider with no discovery and no manual endpoints', async () => {
    await expect(
      upsertIdentityProvider({
        registrationId: 'oidc_x',
        label: 'Acme IdP',
        clientId: 'client-abc',
        enabled: true,
      })
    ).rejects.toMatchObject({
      code: 'INVALID_IDP_CONFIG',
      message: expect.stringMatching(/Discovery URL.*Authorization URL.*Token URL/i),
    })
  })

  it('throws when enabling an existing endpoint-less provider via patch', async () => {
    hoisted.txSelectResult = [
      {
        ...EXISTING_ROW,
        discoveryUrl: null,
        authorizationUrl: null,
        tokenUrl: null,
        enabled: false,
      },
    ]
    await expect(
      upsertIdentityProvider({ ...BASE_INPUT, discoveryUrl: null, enabled: true })
    ).rejects.toMatchObject({ code: 'INVALID_IDP_CONFIG' })
  })

  it('allows enabling with a discovery URL', async () => {
    await upsertIdentityProvider({ ...BASE_INPUT, enabled: true })
    expect(hoisted.mockDbTransaction).toHaveBeenCalledTimes(1)
  })

  it('allows enabling a manual-endpoint provider (authorization + token, no discovery)', async () => {
    await upsertIdentityProvider({
      registrationId: 'oidc_x',
      label: 'Acme IdP',
      clientId: 'client-abc',
      discoveryUrl: null,
      authorizationUrl: 'https://idp.example/authorize',
      tokenUrl: 'https://idp.example/token',
      enabled: true,
    })
    expect(hoisted.mockDbTransaction).toHaveBeenCalledTimes(1)
  })

  it('allows enabling via patch when the stored row already has a discovery URL', async () => {
    hoisted.txSelectResult = [{ ...EXISTING_ROW, enabled: false }] // EXISTING_ROW has discoveryUrl
    await upsertIdentityProvider({ ...BASE_INPUT, discoveryUrl: undefined, enabled: true })
    expect(hoisted.capturedSetPatch!.enabled).toBe(true)
  })

  it('does not gate a disabled provider with no endpoints', async () => {
    await upsertIdentityProvider({
      registrationId: 'oidc_x',
      label: 'Acme IdP',
      clientId: 'client-abc',
      enabled: false,
    })
    expect(hoisted.mockDbTransaction).toHaveBeenCalledTimes(1)
  })
})
