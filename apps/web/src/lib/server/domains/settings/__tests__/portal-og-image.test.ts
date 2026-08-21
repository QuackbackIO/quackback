/**
 * Portal OG image settings tests.
 *
 * Verifies:
 * - savePortalOgImageKey stores the key, removes the replaced S3 object, and
 *   invalidates the tenant settings cache
 * - deletePortalOgImageKey clears the key, removes the S3 object, and
 *   invalidates the cache
 * - getTenantSettings resolves brandingData.ogImageUrl from the stored key
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Cache mocks ---
const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()
const mockCacheDel = vi.fn()

vi.mock('@/lib/server/cache', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheDel: (...args: unknown[]) => mockCacheDel(...args),
  CACHE_KEYS: {
    TENANT_SETTINGS: 'settings:tenant',
    INTEGRATION_MAPPINGS: 'hooks:integration-mappings',
    ACTIVE_WEBHOOKS: 'hooks:webhooks-active',
    SLACK_CHANNELS: 'slack:channels',
    REGISTERED_AUTH_PROVIDERS: 'auth:registered-providers',
  },
}))

// --- DB mock ---
const mockFindFirst = vi.fn()
const mockUpdate = vi.fn()
const mockSet = vi.fn()
const mockWhere = vi.fn()
const mockReturning = vi.fn()

type SettingsTx = {
  query: { settings: { findFirst: (...args: unknown[]) => unknown } }
  update: (...args: unknown[]) => unknown
}

vi.mock('@/lib/server/db', async (importOriginal) => {
  const tx: SettingsTx = {
    query: { settings: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } },
    update: (...args: unknown[]) => mockUpdate(...args),
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      query: {
        settings: {
          findFirst: (...args: unknown[]) => mockFindFirst(...args),
        },
      },
      update: (...args: unknown[]) => mockUpdate(...args),
      select: () => ({
        from: () => ({
          limit: () => Promise.resolve([]),
          orderBy: () => Promise.resolve([]),
        }),
      }),
      transaction: async (fn: (tx: SettingsTx) => unknown) => fn(tx),
    },
    eq: vi.fn(),
  }
})

vi.mock('@/lib/server/auth/config-version', () => ({
  bumpAuthConfigVersionInTx: vi.fn(),
}))

vi.mock('@/lib/server/auth', () => ({
  resetAuth: vi.fn(),
}))

// --- S3 mock ---
const mockDeleteObject = vi.fn()
vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: (key: string | null) => (key ? `https://cdn.test/${key}` : null),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: vi.fn().mockResolvedValue(new Set()),
  getPlatformCredentials: vi.fn().mockResolvedValue(null),
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/server/auth/auth-providers', () => ({
  getAllAuthProviders: vi.fn().mockReturnValue([]),
}))

function makeSettingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'settings_1',
    name: 'Test Workspace',
    slug: 'test',
    authConfig: null,
    portalConfig: null,
    brandingConfig: null,
    developerConfig: null,
    widgetConfig: null,
    customCss: null,
    logoKey: null,
    faviconKey: null,
    headerLogoKey: null,
    portalOgImageKey: null,
    headerDisplayMode: 'logo_and_name',
    headerDisplayName: null,
    widgetSecret: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  }
}

// Import after mocks
const { getTenantSettings } = await import('../settings.service')
const { savePortalOgImageKey, deletePortalOgImageKey } = await import('../settings.media')

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheGet.mockResolvedValue(null)
  mockCacheSet.mockResolvedValue(undefined)
  mockCacheDel.mockResolvedValue(undefined)
  mockDeleteObject.mockResolvedValue(undefined)
  // Chain: db.update().set().where().returning()
  mockReturning.mockResolvedValue([makeSettingsRow()])
  mockWhere.mockReturnValue({ returning: mockReturning })
  mockSet.mockReturnValue({ where: mockWhere })
  mockUpdate.mockReturnValue({ set: mockSet })
})

describe('savePortalOgImageKey', () => {
  beforeEach(() => {
    mockFindFirst.mockResolvedValue(makeSettingsRow())
  })

  it('stores the key and invalidates the tenant settings cache', async () => {
    const result = await savePortalOgImageKey('portal-og/og.png')

    expect(result).toEqual({ success: true, key: 'portal-og/og.png' })
    expect(mockSet).toHaveBeenCalledWith({ portalOgImageKey: 'portal-og/og.png' })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant', 'auth:registered-providers')
  })

  it('deletes the replaced S3 object', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow({ portalOgImageKey: 'portal-og/old.png' }))

    await savePortalOgImageKey('portal-og/new.png')

    expect(mockDeleteObject).toHaveBeenCalledWith('portal-og/old.png')
  })
})

describe('deletePortalOgImageKey', () => {
  it('clears the key, deletes the S3 object, and invalidates the cache', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow({ portalOgImageKey: 'portal-og/og.png' }))

    const result = await deletePortalOgImageKey()

    expect(result).toEqual({ success: true })
    expect(mockDeleteObject).toHaveBeenCalledWith('portal-og/og.png')
    expect(mockSet).toHaveBeenCalledWith({ portalOgImageKey: null })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant', 'auth:registered-providers')
  })

  it('does not touch S3 when no image is set', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow())

    await deletePortalOgImageKey()

    expect(mockDeleteObject).not.toHaveBeenCalled()
  })
})

describe('getTenantSettings brandingData.ogImageUrl', () => {
  it('resolves the public URL from the stored key', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow({ portalOgImageKey: 'portal-og/og.png' }))

    const result = await getTenantSettings()

    expect(result?.brandingData.ogImageUrl).toBe('https://cdn.test/portal-og/og.png')
  })

  it('is null when no OG image is set', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow())

    const result = await getTenantSettings()

    expect(result?.brandingData.ogImageUrl).toBeNull()
  })
})
