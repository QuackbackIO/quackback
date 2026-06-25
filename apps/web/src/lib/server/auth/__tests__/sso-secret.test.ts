/**
 * Tests for the SSO client-secret presence helper.
 *
 * `hasSsoClientSecret` reads the cached configured-integration-types
 * Set so callers don't trigger a fresh decryption.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockGetConfiguredIntegrationTypes: vi.fn(),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: hoisted.mockGetConfiguredIntegrationTypes,
}))

const { hasSsoClientSecret } = await import('../sso-secret')

beforeEach(() => {
  vi.clearAllMocks()
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
