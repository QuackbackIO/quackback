import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  mockSavePlatformCredentials: vi.fn(async () => undefined),
  mockGetTierLimits: vi.fn(),
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({ principal: { id: 'principal_admin' } })),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  savePlatformCredentials: hoisted.mockSavePlatformCredentials,
  deletePlatformCredentials: vi.fn(),
  getPlatformCredentials: vi.fn(),
  getConfiguredIntegrationTypes: vi.fn(async () => new Set()),
}))

vi.mock('@/lib/server/auth/index', () => ({ resetAuth: vi.fn() }))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { saveAuthProviderCredentialsFn } from '../auth-provider-credentials'

const validOidcCreds = {
  clientId: 'client_abc',
  clientSecret: 'secret_xyz',
  discoveryUrl: 'https://example.okta.com/.well-known/openid-configuration',
}

describe('saveAuthProviderCredentialsFn — customOidcProvider gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses generic-oauth (custom-oidc) save when feature is off', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
    })

    await expect(
      saveAuthProviderCredentialsFn({
        data: { credentialType: 'auth_custom-oidc', credentials: validOidcCreds },
      })
    ).rejects.toBeInstanceOf(TierLimitError)

    expect(hoisted.mockSavePlatformCredentials).not.toHaveBeenCalled()
  })

  it('allows generic-oauth save when feature is on (Scale tier / OSS default)', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue(OSS_TIER_LIMITS)

    await saveAuthProviderCredentialsFn({
      data: { credentialType: 'auth_custom-oidc', credentials: validOidcCreds },
    })

    expect(hoisted.mockSavePlatformCredentials).toHaveBeenCalledTimes(1)
  })

  it('allows built-in social providers (Google) regardless of customOidcProvider flag', async () => {
    // Google / GitHub / Microsoft are operator-level infrastructure for
    // self-hosters, not an enterprise SSO tier feature. Tier flag has no
    // bearing on whether the operator can save Google client creds.
    hoisted.mockGetTierLimits.mockResolvedValue({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features, customOidcProvider: false },
    })

    await saveAuthProviderCredentialsFn({
      data: {
        credentialType: 'auth_google',
        credentials: { clientId: 'g_id', clientSecret: 'g_secret' },
      },
    })

    expect(hoisted.mockSavePlatformCredentials).toHaveBeenCalledTimes(1)
    expect(hoisted.mockGetTierLimits).not.toHaveBeenCalled()
  })
})
