/**
 * Lockout guard on credential deletion.
 *
 * `deleteAuthProviderCredentialsFn` disables the provider via the low-level
 * `updateAuthConfig`, which bypasses `updateAuthConfigFn`'s
 * `wouldLeaveNoWorkingSignInMethod` backstop. The fn must enforce that invariant
 * itself BEFORE deleting, or a direct API call can strip the workspace of its
 * last working sign-in method (Codex P1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  mockDeletePlatformCredentials: vi.fn(async () => undefined),
  mockGetAuthConfig: vi.fn(),
  mockUpdateAuthConfig: vi.fn(async () => undefined),
  mockWouldLeaveNoWorkingSignInMethod: vi.fn(),
  mockResetAuth: vi.fn(),
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({ principal: { id: 'principal_admin' } })),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  savePlatformCredentials: vi.fn(),
  deletePlatformCredentials: hoisted.mockDeletePlatformCredentials,
  getPlatformCredentials: vi.fn(),
  getConfiguredIntegrationTypes: vi.fn(async () => new Set()),
}))

vi.mock('@/lib/server/auth/auth-providers', () => ({
  getAuthProvider: (id: string) => ({ id, type: 'social', credentialType: `auth_${id}` }),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getAuthConfig: hoisted.mockGetAuthConfig,
  updateAuthConfig: hoisted.mockUpdateAuthConfig,
}))

vi.mock('@/lib/server/auth/sign-in-method-availability', () => ({
  wouldLeaveNoWorkingSignInMethod: hoisted.mockWouldLeaveNoWorkingSignInMethod,
}))

vi.mock('@/lib/server/auth/index', () => ({ resetAuth: hoisted.mockResetAuth }))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn() }) },
}))

import { deleteAuthProviderCredentialsFn } from '../auth-provider-credentials'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('deleteAuthProviderCredentialsFn — last-method lockout guard', () => {
  it('refuses to delete the credentials of the only working method', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({ oauth: { google: true } })
    hoisted.mockWouldLeaveNoWorkingSignInMethod.mockResolvedValue(true)

    await expect(
      deleteAuthProviderCredentialsFn({ data: { credentialType: 'google' } })
    ).rejects.toBeInstanceOf(ConflictError)

    // Nothing deleted or disabled — abort while the method is still intact.
    expect(hoisted.mockDeletePlatformCredentials).not.toHaveBeenCalled()
    expect(hoisted.mockUpdateAuthConfig).not.toHaveBeenCalled()
    // The guard evaluated the provider's removal (id set to false).
    expect(hoisted.mockWouldLeaveNoWorkingSignInMethod).toHaveBeenCalledWith({ google: false })
  })

  it('deletes + disables when another working method remains', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({ oauth: { google: true, password: true } })
    hoisted.mockWouldLeaveNoWorkingSignInMethod.mockResolvedValue(false)

    await deleteAuthProviderCredentialsFn({ data: { credentialType: 'google' } })

    expect(hoisted.mockDeletePlatformCredentials).toHaveBeenCalledWith('google')
    expect(hoisted.mockUpdateAuthConfig).toHaveBeenCalledWith({ oauth: { google: false } })
  })

  it('skips the guard for a provider that is not enabled (removing it cannot lock out)', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({ oauth: { password: true } }) // google absent/off

    await deleteAuthProviderCredentialsFn({ data: { credentialType: 'google' } })

    expect(hoisted.mockWouldLeaveNoWorkingSignInMethod).not.toHaveBeenCalled()
    expect(hoisted.mockDeletePlatformCredentials).toHaveBeenCalledWith('google')
    expect(hoisted.mockUpdateAuthConfig).not.toHaveBeenCalled()
  })
})
