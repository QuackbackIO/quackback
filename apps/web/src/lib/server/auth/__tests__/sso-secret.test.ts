/**
 * Tests for the SSO client-secret read helpers.
 *
 * `getSsoClientSecret` decrypts via `getPlatformCredentials`;
 * `hasSsoClientSecret` reads the cached configured-integration-types
 * Set so status-page renders don't trigger a fresh decryption.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockGetPlatformCredentials: vi.fn(),
  mockGetConfiguredIntegrationTypes: vi.fn(),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: hoisted.mockGetPlatformCredentials,
  getConfiguredIntegrationTypes: hoisted.mockGetConfiguredIntegrationTypes,
}))

const { getSsoClientSecret, hasSsoClientSecret, SSO_CREDENTIAL_TYPE } =
  await import('../sso-secret')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getSsoClientSecret', () => {
  it('returns the client secret when DB row exists', async () => {
    hoisted.mockGetPlatformCredentials.mockResolvedValue({ clientSecret: 'shh-from-db' })
    const result = await getSsoClientSecret()
    expect(result).toBe('shh-from-db')
    expect(hoisted.mockGetPlatformCredentials).toHaveBeenCalledWith(SSO_CREDENTIAL_TYPE)
  })

  it('returns null when DB row is missing', async () => {
    hoisted.mockGetPlatformCredentials.mockResolvedValue(null)
    const result = await getSsoClientSecret()
    expect(result).toBeNull()
  })

  it('returns null when DB row is missing the clientSecret field', async () => {
    hoisted.mockGetPlatformCredentials.mockResolvedValue({})
    const result = await getSsoClientSecret()
    expect(result).toBeNull()
  })
})

describe('hasSsoClientSecret', () => {
  it('returns true when the cached set includes auth_sso', async () => {
    hoisted.mockGetConfiguredIntegrationTypes.mockResolvedValue(
      new Set(['auth_sso', 'auth_google'])
    )
    const result = await hasSsoClientSecret()
    expect(result).toBe(true)
  })

  it('returns false when the cached set does not include auth_sso', async () => {
    hoisted.mockGetConfiguredIntegrationTypes.mockResolvedValue(new Set(['auth_google']))
    const result = await hasSsoClientSecret()
    expect(result).toBe(false)
  })

  it('returns false on an empty configured-types set', async () => {
    hoisted.mockGetConfiguredIntegrationTypes.mockResolvedValue(new Set())
    const result = await hasSsoClientSecret()
    expect(result).toBe(false)
  })
})
