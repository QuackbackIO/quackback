/**
 * Help Center Config service tests.
 *
 * Verifies:
 * - getHelpCenterConfig() returns defaults when null in DB
 * - getHelpCenterConfig() parses and merges stored config
 * - updateHelpCenterConfig() partial merges and persists
 * - updateHelpCenterConfig() invalidates cache
 * - getTenantSettings() includes helpCenterConfig
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
vi.mock('@quackback/email', () => ({
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
    helpCenterConfig: null,
    featureFlags: null,
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
const { getHelpCenterConfig, updateHelpCenterConfig, getTenantSettings } =
  await import('../settings.service')
const { DEFAULT_HELP_CENTER_CONFIG, DEFAULT_HELP_CENTER_SEO_CONFIG } =
  await import('../settings.types')

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
// getHelpCenterConfig
// ============================================================================

describe('getHelpCenterConfig', () => {
  it('returns defaults when helpCenterConfig is null in DB', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow({ helpCenterConfig: null }))

    const result = await getHelpCenterConfig()

    expect(result).toEqual(DEFAULT_HELP_CENTER_CONFIG)
  })

  it('returns defaults when helpCenterConfig is invalid JSON', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow({ helpCenterConfig: 'not json' }))

    const result = await getHelpCenterConfig()

    expect(result).toEqual(DEFAULT_HELP_CENTER_CONFIG)
  })

  it('parses and merges stored config with defaults', async () => {
    const stored = JSON.stringify({
      enabled: true,
      homepageTitle: 'Custom Title',
    })
    mockFindFirst.mockResolvedValue(makeSettingsRow({ helpCenterConfig: stored }))

    const result = await getHelpCenterConfig()

    expect(result.enabled).toBe(true)
    expect(result.homepageTitle).toBe('Custom Title')
    // Defaults preserved
    expect(result.homepageDescription).toBe('Search our knowledge base or browse by category')
    expect(result.seo).toEqual(DEFAULT_HELP_CENTER_SEO_CONFIG)
  })

  it('deep merges nested seo config', async () => {
    const stored = JSON.stringify({
      seo: {
        metaDescription: 'Custom meta',
        sitemapEnabled: false,
      },
    })
    mockFindFirst.mockResolvedValue(makeSettingsRow({ helpCenterConfig: stored }))

    const result = await getHelpCenterConfig()

    expect(result.seo.metaDescription).toBe('Custom meta')
    expect(result.seo.sitemapEnabled).toBe(false)
    // Preserved from defaults
    expect(result.seo.structuredDataEnabled).toBe(true)
    expect(result.seo.ogImageKey).toBeNull()
  })
})

// ============================================================================
// updateHelpCenterConfig
// ============================================================================

describe('updateHelpCenterConfig', () => {
  it('merges partial input with existing config and persists', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow({ helpCenterConfig: null }))

    const result = await updateHelpCenterConfig({ enabled: true, homepageTitle: 'New Title' })

    expect(result.enabled).toBe(true)
    expect(result.homepageTitle).toBe('New Title')
    // Defaults preserved
    expect(result.seo).toEqual(DEFAULT_HELP_CENTER_SEO_CONFIG)

    // Should have persisted
    expect(mockUpdate).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith({
      helpCenterConfig: JSON.stringify(result),
    })
  })

  it('merges with existing stored values', async () => {
    const existing = JSON.stringify({
      enabled: true,
      homepageTitle: 'Existing Title',
    })
    mockFindFirst.mockResolvedValue(makeSettingsRow({ helpCenterConfig: existing }))

    const result = await updateHelpCenterConfig({ homepageDescription: 'New desc' })

    expect(result.enabled).toBe(true)
    expect(result.homepageTitle).toBe('Existing Title')
    expect(result.homepageDescription).toBe('New desc')
  })

  it('invalidates cache after update', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow())

    await updateHelpCenterConfig({ enabled: true })

    expect(mockCacheDel).toHaveBeenCalledWith('settings:tenant')
  })

  it('can update nested seo config', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow())

    const result = await updateHelpCenterConfig({
      seo: {
        metaDescription: 'Updated meta',
        sitemapEnabled: false,
        structuredDataEnabled: true,
        ogImageKey: null,
      },
    })

    expect(result.seo.metaDescription).toBe('Updated meta')
    expect(result.seo.sitemapEnabled).toBe(false)
  })
})

// ============================================================================
// getTenantSettings includes helpCenterConfig
// ============================================================================

describe('getTenantSettings includes helpCenterConfig', () => {
  it('includes default helpCenterConfig when DB column is null', async () => {
    mockCacheGet.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue(makeSettingsRow({ helpCenterConfig: null }))

    const result = await getTenantSettings()

    expect(result).not.toBeNull()
    expect(result!.helpCenterConfig).toEqual(DEFAULT_HELP_CENTER_CONFIG)
  })

  it('includes parsed helpCenterConfig from DB', async () => {
    const stored = JSON.stringify({
      enabled: true,
      homepageTitle: 'Help',
    })
    mockCacheGet.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue(makeSettingsRow({ helpCenterConfig: stored }))

    const result = await getTenantSettings()

    expect(result).not.toBeNull()
    expect(result!.helpCenterConfig.enabled).toBe(true)
    expect(result!.helpCenterConfig.homepageTitle).toBe('Help')
    // Defaults merged
    expect(result!.helpCenterConfig.seo).toEqual(DEFAULT_HELP_CENTER_SEO_CONFIG)
  })
})
