/**
 * Platform credential cache invalidation tests.
 *
 * Verifies that savePlatformCredentials and deletePlatformCredentials
 * invalidate the TENANT_SETTINGS cache key.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Redis cache mocks ---
const mockCacheDel = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheDel: (...args: unknown[]) => mockCacheDel(...args),
  CACHE_KEYS: {
    TENANT_SETTINGS: 'settings:tenant',
  },
}))

// --- DB mocks ---
const mockInsert = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
  integrationPlatformCredentials: {
    integrationType: 'integrationType',
  },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/integrations/encryption', () => ({
  encryptPlatformCredentials: vi.fn().mockReturnValue('encrypted'),
  decryptPlatformCredentials: vi.fn(),
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn().mockReturnValue('platform_cred_1'),
}))

const { savePlatformCredentials, deletePlatformCredentials } =
  await import('../platform-credential.service')

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheDel.mockResolvedValue(undefined)
  // insert chain: .values().onConflictDoUpdate()
  mockInsert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }),
  })
  // delete chain: .where()
  mockDelete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
})

describe('platform credential cache invalidation', () => {
  it('savePlatformCredentials invalidates TENANT_SETTINGS cache', async () => {
    await savePlatformCredentials({
      integrationType: 'slack',
      credentials: { clientId: 'id', clientSecret: 'secret' },
      principalId: 'principal_1' as any,
    })

    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('deletePlatformCredentials invalidates TENANT_SETTINGS cache', async () => {
    await deletePlatformCredentials('slack')

    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })
})
