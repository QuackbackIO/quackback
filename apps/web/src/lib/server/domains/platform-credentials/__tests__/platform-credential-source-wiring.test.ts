/**
 * Platform-credential service source-selection wiring.
 *
 * In managed cloud (PLATFORM_CREDENTIALS_SOURCE=env) the service must read shared
 * OAuth-app credentials from INTEGRATION_<PROVIDER>_<FIELD> env (not the DB), and
 * writes must be refused (credentials are platform-managed). Self-host (default)
 * is unchanged and covered by platform-credential-cache.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

vi.mock('@/lib/server/redis', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  CACHE_KEYS: {
    TENANT_SETTINGS: 'settings:tenant',
    PLATFORM_INTEGRATION_TYPES: 'platform-cred:configured-types',
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      integrationPlatformCredentials: { findFirst: vi.fn(), findMany: vi.fn() },
    },
  },
  integrationPlatformCredentials: { integrationType: 'integrationType' },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/integrations/encryption', () => ({
  encryptPlatformCredentials: vi.fn(),
  decryptPlatformCredentials: vi.fn(),
}))

const ORIGINAL_SOURCE = process.env.PLATFORM_CREDENTIALS_SOURCE

describe('platform credential source wiring — env (managed cloud)', () => {
  beforeEach(() => {
    process.env.PLATFORM_CREDENTIALS_SOURCE = 'env'
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
  })

  it('hasPlatformCredentials reflects env presence', async () => {
    process.env.INTEGRATION_SLACK_CLIENT_ID = 'envid'
    const { hasPlatformCredentials } = await import('../platform-credential.service')
    expect(await hasPlatformCredentials('slack')).toBe(true)
    expect(await hasPlatformCredentials('discord')).toBe(false)
  })

  it('savePlatformCredentials refuses writes (platform-managed)', async () => {
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

  it('deletePlatformCredentials refuses writes (platform-managed)', async () => {
    const { deletePlatformCredentials, PlatformCredentialsManagedError } =
      await import('../platform-credential.service')
    await expect(deletePlatformCredentials('slack')).rejects.toBeInstanceOf(
      PlatformCredentialsManagedError
    )
  })
})
