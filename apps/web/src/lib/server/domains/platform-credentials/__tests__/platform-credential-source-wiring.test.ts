/**
 * Platform-credential service source-selection wiring.
 *
 * In managed cloud (PLATFORM_CREDENTIALS_SOURCE=env) the service reads shared
 * OAuth-app credentials for the 24 integrations from INTEGRATION_<PROVIDER>_<FIELD>
 * env (not the DB), and refuses writes (credentials are platform-managed).
 *
 * Social-login / SSO credentials (auth_*) are a separate concern: they stay
 * DB-backed (read AND write) and configurable even in env mode, so SSO and
 * social-login registration keep working. Self-host (default) is unchanged and
 * covered by platform-credential-cache.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()
const mockCacheDel = vi.fn()
const mockFindFirst = vi.fn()
const mockFindMany = vi.fn()
const mockInsert = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheGet: (...a: unknown[]) => mockCacheGet(...a),
  cacheSet: (...a: unknown[]) => mockCacheSet(...a),
  cacheDel: (...a: unknown[]) => mockCacheDel(...a),
  CACHE_KEYS: {
    TENANT_SETTINGS: 'settings:tenant',
    PLATFORM_INTEGRATION_TYPES: 'platform-cred:configured-types',
  },
}))

vi.mock('@/lib/server/db', () => {
  const tx = {
    insert: (...a: unknown[]) => mockInsert(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  }
  return {
    db: {
      query: {
        integrationPlatformCredentials: {
          findFirst: (...a: unknown[]) => mockFindFirst(...a),
          findMany: (...a: unknown[]) => mockFindMany(...a),
        },
      },
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
    integrationPlatformCredentials: { integrationType: 'integrationType' },
    eq: vi.fn(),
  }
})

vi.mock('@/lib/server/integrations/encryption', () => ({
  encryptPlatformCredentials: vi.fn().mockReturnValue('encrypted'),
  decryptPlatformCredentials: vi.fn(() => ({ clientId: 'db-id', clientSecret: 'db-secret' })),
}))

// EnvCredentialSource enumerates the registry and reads each provider's required
// platform-credential fields (slack needs clientId + clientSecret here).
vi.mock('@/lib/server/integrations', () => ({
  listIntegrationTypes: () => ['slack', 'discord', 'linear'],
  getIntegration: (type: string) =>
    type === 'slack'
      ? { platformCredentials: [{ key: 'clientId' }, { key: 'clientSecret' }] }
      : undefined,
}))

vi.mock('@/lib/server/auth/config-version', () => ({ bumpAuthConfigVersionInTx: vi.fn() }))
vi.mock('@/lib/server/auth', () => ({ resetAuth: vi.fn() }))
vi.mock('@quackback/ids', () => ({ generateId: vi.fn().mockReturnValue('platform_cred_1') }))

const ORIGINAL_SOURCE = process.env.PLATFORM_CREDENTIALS_SOURCE

describe('platform credential source wiring — env (managed cloud)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PLATFORM_CREDENTIALS_SOURCE = 'env'
    mockCacheGet.mockResolvedValue(null)
    mockCacheSet.mockResolvedValue(undefined)
    mockCacheDel.mockResolvedValue(undefined)
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) }),
    })
    mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  })
  afterEach(() => {
    if (ORIGINAL_SOURCE === undefined) delete process.env.PLATFORM_CREDENTIALS_SOURCE
    else process.env.PLATFORM_CREDENTIALS_SOURCE = ORIGINAL_SOURCE
    delete process.env.INTEGRATION_SLACK_CLIENT_ID
    delete process.env.INTEGRATION_SLACK_CLIENT_SECRET
  })

  it('getPlatformCredentials reads INTEGRATION_<TYPE>_<FIELD> env, not the DB', async () => {
    process.env.INTEGRATION_SLACK_CLIENT_ID = 'envid'
    process.env.INTEGRATION_SLACK_CLIENT_SECRET = 'envsec'
    const { getPlatformCredentials } = await import('../platform-credential.service')
    expect(await getPlatformCredentials('slack')).toEqual({
      clientId: 'envid',
      clientSecret: 'envsec',
    })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('hasPlatformCredentials is true only when fully configured', async () => {
    process.env.INTEGRATION_SLACK_CLIENT_ID = 'envid'
    process.env.INTEGRATION_SLACK_CLIENT_SECRET = 'envsec'
    const { hasPlatformCredentials } = await import('../platform-credential.service')
    expect(await hasPlatformCredentials('slack')).toBe(true)
    expect(await hasPlatformCredentials('discord')).toBe(false)
  })

  it('savePlatformCredentials refuses integration writes (platform-managed)', async () => {
    const { savePlatformCredentials, PlatformCredentialsManagedError } =
      await import('../platform-credential.service')
    await expect(
      savePlatformCredentials({
        integrationType: 'slack',
        credentials: { clientId: 'x' },
        principalId: 'principal_1' as PrincipalId,
      })
    ).rejects.toBeInstanceOf(PlatformCredentialsManagedError)
  })

  it('deletePlatformCredentials refuses integration writes (platform-managed)', async () => {
    const { deletePlatformCredentials, PlatformCredentialsManagedError } =
      await import('../platform-credential.service')
    await expect(deletePlatformCredentials('slack')).rejects.toBeInstanceOf(
      PlatformCredentialsManagedError
    )
  })

  // auth_* credentials are NOT governed by the env switch.

  it('getPlatformCredentials(auth_*) still reads the DB in env mode', async () => {
    mockFindFirst.mockResolvedValue({ secrets: 'enc' })
    const { getPlatformCredentials } = await import('../platform-credential.service')
    expect(await getPlatformCredentials('auth_sso')).toEqual({
      clientId: 'db-id',
      clientSecret: 'db-secret',
    })
    expect(mockFindFirst).toHaveBeenCalled()
  })

  it('savePlatformCredentials(auth_*) is allowed in env mode (DB-managed)', async () => {
    const { savePlatformCredentials } = await import('../platform-credential.service')
    await expect(
      savePlatformCredentials({
        integrationType: 'auth_google',
        credentials: { clientId: 'x', clientSecret: 'y' },
        principalId: 'principal_1' as PrincipalId,
      })
    ).resolves.toBeUndefined()
    expect(mockInsert).toHaveBeenCalled()
  })

  it('getConfiguredIntegrationTypes unions env integrations with DB auth_* types', async () => {
    process.env.INTEGRATION_SLACK_CLIENT_ID = 'id'
    process.env.INTEGRATION_SLACK_CLIENT_SECRET = 's'
    mockFindMany.mockResolvedValue([
      { integrationType: 'auth_sso' },
      { integrationType: 'auth_github' },
    ])
    const { getConfiguredIntegrationTypes } = await import('../platform-credential.service')
    const result = await getConfiguredIntegrationTypes()
    expect([...result].sort()).toEqual(['auth_github', 'auth_sso', 'slack'])
  })
})
