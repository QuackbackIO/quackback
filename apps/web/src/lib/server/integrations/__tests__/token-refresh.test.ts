/**
 * Unified token refresh (IF WO-13): expiry buffer, refresh with BY-ID
 * persistence, resolver-cache invalidation, and graceful fallbacks. Runs
 * inside the transactional db fixture; the Jira refresh endpoint and
 * platform credentials are mocked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/redis')>()),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/integrations/jira/server/oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/integrations/jira/server/oauth')>()),
  refreshJiraToken: vi.fn(),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn().mockResolvedValue(null),
}))

// Real AES encryption needs config.secretKey (unset in unit tests) and is
// incidental here — the boundary under test is refresh + persistence.
vi.mock('../encryption', () => ({
  encryptSecrets: vi.fn((v: unknown) => JSON.stringify(v)),
  decryptSecrets: vi.fn((v: string) => JSON.parse(v)),
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { integrations, eq } from '@/lib/server/db'
import { encryptSecrets, decryptSecrets } from '../encryption'
import { getValidAccessToken } from '../token-refresh'
import { refreshJiraToken } from '@/integrations/jira/server/oauth'
import { cacheDel, CACHE_KEYS } from '@/lib/server/redis'
import type { IntegrationId } from '@quackback/ids'

const fixture = await createDbTestFixture()

const refreshJiraTokenMock = vi.mocked(refreshJiraToken)

async function seedIntegration(overrides: {
  integrationType?: string
  tokenExpiresAt?: string
  secrets?: Record<string, string>
}): Promise<IntegrationId> {
  const [row] = await testDb
    .insert(integrations)
    .values({
      integrationType: overrides.integrationType ?? 'jira',
      status: 'active',
      secrets: encryptSecrets(
        overrides.secrets ?? { accessToken: 'stored-token', refreshToken: 'stored-refresh' }
      ),
      config: {
        cloudId: 'cloud-1',
        ...(overrides.tokenExpiresAt ? { tokenExpiresAt: overrides.tokenExpiresAt } : {}),
      },
    })
    .returning()
  return row.id as IntegrationId
}

describe('getValidAccessToken', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('returns the stored token untouched when not near expiry', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')
    expect(refreshJiraTokenMock).not.toHaveBeenCalled()
    expect(cacheDel).not.toHaveBeenCalled()
  })

  it('refreshes an expired token, persists BY ID, and busts the resolver cache', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    refreshJiraTokenMock.mockResolvedValue({
      accessToken: 'fresh-token',
      refreshToken: 'fresh-refresh',
      expiresIn: 3600,
    })

    await expect(getValidAccessToken(id)).resolves.toBe('fresh-token')
    expect(refreshJiraTokenMock).toHaveBeenCalledWith('stored-refresh', undefined)
    expect(cacheDel).toHaveBeenCalledWith(CACHE_KEYS.INTEGRATION_MAPPINGS)

    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    const secrets = decryptSecrets<Record<string, string>>(row!.secrets!)
    expect(secrets.accessToken).toBe('fresh-token')
    expect(secrets.refreshToken).toBe('fresh-refresh')
    const config = row!.config as Record<string, unknown>
    expect(new Date(config.tokenExpiresAt as string).getTime()).toBeGreaterThan(Date.now())
  })

  it('refreshes within the 5-minute buffer, not only after hard expiry', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    })
    // The real Jira endpoint always rotates, but the slot contract allows
    // providers that don't — the stored refresh token must survive.
    refreshJiraTokenMock.mockResolvedValue({
      accessToken: 'fresh-token',
      expiresIn: 3600,
    } as Awaited<ReturnType<typeof refreshJiraToken>>)

    await expect(getValidAccessToken(id)).resolves.toBe('fresh-token')
    // No rotated refresh token in the response — the stored one is kept.
    const row = await testDb.query.integrations.findFirst({ where: eq(integrations.id, id) })
    const secrets = decryptSecrets<Record<string, string>>(row!.secrets!)
    expect(secrets.refreshToken).toBe('stored-refresh')
  })

  it('falls back to the stored token when the refresh call fails', async () => {
    const id = await seedIntegration({
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    refreshJiraTokenMock.mockRejectedValue(new Error('token endpoint down'))

    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')
    expect(cacheDel).not.toHaveBeenCalled()
  })

  it('returns the stored token for providers without a refreshToken capability', async () => {
    const id = await seedIntegration({
      integrationType: 'github',
      tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')
    expect(refreshJiraTokenMock).not.toHaveBeenCalled()
  })

  it('reads snake_case token keys (access_token/refresh_token fallback)', async () => {
    const id = await seedIntegration({
      secrets: { access_token: 'snake-token', refresh_token: 'snake-refresh' },
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    await expect(getValidAccessToken(id)).resolves.toBe('snake-token')
  })

  it('returns the stored token when no expiry is recorded (non-expiring tokens)', async () => {
    const id = await seedIntegration({})
    await expect(getValidAccessToken(id)).resolves.toBe('stored-token')
    expect(refreshJiraTokenMock).not.toHaveBeenCalled()
  })
})
