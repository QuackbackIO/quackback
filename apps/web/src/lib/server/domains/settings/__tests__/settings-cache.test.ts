/**
 * Settings service caching tests.
 *
 * Verifies:
 * - getTenantSettings() returns cached result on hit
 * - getTenantSettings() queries DB and populates cache on miss
 * - All write functions invalidate the cache
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Redis cache mocks ---
const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()
const mockCacheDel = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheGet: (...args: unknown[]) => mockCacheGet(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
  cacheDel: (...args: unknown[]) => mockCacheDel(...args),
  CACHE_KEYS: {
    TENANT_SETTINGS: 'settings:tenant',
    INTEGRATION_MAPPINGS: 'hooks:integration-mappings',
    ACTIVE_WEBHOOKS: 'hooks:webhooks-active',
    SLACK_CHANNELS: 'slack:channels',
  },
}))

// --- DB mock ---
const mockFindFirst = vi.fn()
const mockUpdate = vi.fn()
const mockSet = vi.fn()
const mockWhere = vi.fn()
const mockReturning = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      settings: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    update: (...args: unknown[]) => mockUpdate(...args),
  },
  eq: vi.fn(),
  settings: { id: 'id' },
}))

// --- S3 mock ---
vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: (key: string | null) => (key ? `https://cdn.test/${key}` : null),
  deleteObject: vi.fn(),
}))

// --- Platform credential mock ---
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: vi.fn().mockResolvedValue(new Set()),
  getPlatformCredentials: vi.fn().mockResolvedValue(null),
}))

// --- Email mock ---
vi.mock('@featurepool/email', () => ({
  isEmailConfigured: vi.fn().mockReturnValue(false),
}))

// --- Auth providers mock ---
vi.mock('@/lib/server/auth/auth-providers', () => ({
  getAllAuthProviders: vi.fn().mockReturnValue([]),
}))

// A minimal settings row that satisfies requireSettings
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
    headerDisplayMode: 'logo_and_name',
    headerDisplayName: null,
    widgetSecret: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  }
}

// Import after mocks
const { getTenantSettings, updateAuthConfig, updatePortalConfig, updateDeveloperConfig } =
  await import('../settings.service')
const { invalidateSettingsCache } = await import('../settings.helpers')
const {
  updateBrandingConfig,
  updateCustomCss,
  updateWorkspaceName,
  updateHeaderDisplayMode,
  updateHeaderDisplayName,
  saveLogoKey,
  deleteLogoKey,
  saveFaviconKey,
  deleteFaviconKey,
  saveHeaderLogoKey,
  deleteHeaderLogoKey,
} = await import('../settings.media')
const { updateWidgetConfig, regenerateWidgetSecret } = await import('../settings.widget')

beforeEach(() => {
  vi.clearAllMocks()
  mockCacheGet.mockResolvedValue(null)
  mockCacheSet.mockResolvedValue(undefined)
  mockCacheDel.mockResolvedValue(undefined)
  // Chain: db.update().set().where().returning()
  mockReturning.mockResolvedValue([makeSettingsRow()])
  mockWhere.mockReturnValue({ returning: mockReturning })
  mockSet.mockReturnValue({ where: mockWhere })
  mockUpdate.mockReturnValue({ set: mockSet })
})

// ============================================================================
// getTenantSettings caching
// ============================================================================

describe('getTenantSettings', () => {
  it('returns cached result on cache hit without querying DB', async () => {
    const cached = {
      name: 'Cached Workspace',
      slug: 'cached',
      settings: makeSettingsRow({ name: 'Cached Workspace' }),
    }
    mockCacheGet.mockResolvedValue(cached)

    const result = await getTenantSettings()

    expect(result).toEqual(cached)
    expect(mockCacheGet).toHaveBeenCalledWith('settings:tenant')
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('queries DB and caches result on cache miss', async () => {
    mockCacheGet.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue(makeSettingsRow())

    const result = await getTenantSettings()

    expect(result).not.toBeNull()
    expect(mockFindFirst).toHaveBeenCalled()
    expect(mockCacheSet).toHaveBeenCalledWith(
      'settings:tenant',
      expect.objectContaining({ name: 'Test Workspace' }),
      300
    )
  })

  it('returns null when no settings exist (does not cache null)', async () => {
    mockCacheGet.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue(null)

    const result = await getTenantSettings()

    expect(result).toBeNull()
    expect(mockCacheSet).not.toHaveBeenCalled()
  })
})

// ============================================================================
// invalidateSettingsCache
// ============================================================================

describe('invalidateSettingsCache', () => {
  it('deletes the tenant settings cache key', async () => {
    await invalidateSettingsCache()

    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })
})

// ============================================================================
// Write functions invalidate cache
// ============================================================================

describe('settings write functions invalidate cache', () => {
  // All write functions need a settings row to work with
  beforeEach(() => {
    mockFindFirst.mockResolvedValue(makeSettingsRow())
  })

  it('updateAuthConfig invalidates cache', async () => {
    await updateAuthConfig({ oauth: { password: true } })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('updatePortalConfig invalidates cache', async () => {
    await updatePortalConfig({ oauth: { password: true }, features: {} })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('updateBrandingConfig invalidates cache', async () => {
    await updateBrandingConfig({ preset: 'custom' })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('updateCustomCss invalidates cache', async () => {
    await updateCustomCss('.test { color: red; }')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('updateDeveloperConfig invalidates cache', async () => {
    await updateDeveloperConfig({ mcpEnabled: true })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('updateWidgetConfig invalidates cache', async () => {
    await updateWidgetConfig({ enabled: true })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('updateWorkspaceName invalidates cache', async () => {
    await updateWorkspaceName('New Name')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('updateHeaderDisplayMode invalidates cache', async () => {
    await updateHeaderDisplayMode('logo_only')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('updateHeaderDisplayName invalidates cache', async () => {
    await updateHeaderDisplayName('Custom Name')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('saveLogoKey invalidates cache', async () => {
    await saveLogoKey('logos/new.png')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('deleteLogoKey invalidates cache', async () => {
    await deleteLogoKey()
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('saveFaviconKey invalidates cache', async () => {
    await saveFaviconKey('favicons/new.ico')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('deleteFaviconKey invalidates cache', async () => {
    await deleteFaviconKey()
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('saveHeaderLogoKey invalidates cache', async () => {
    await saveHeaderLogoKey('headers/new.png')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('deleteHeaderLogoKey invalidates cache', async () => {
    await deleteHeaderLogoKey()
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('regenerateWidgetSecret invalidates cache', async () => {
    await regenerateWidgetSecret()
    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })
})
