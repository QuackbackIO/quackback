/**
 * Settings service caching tests.
 *
 * Verifies:
 * - getWorkspaceSettings() returns cached result on hit
 * - getWorkspaceSettings() queries DB and populates cache on miss
 * - All write functions invalidate the cache
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
    WORKSPACE_SETTINGS: 'settings:workspace',
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
    // Spread the real db module so tables/operators stay current; override only what this suite drives.
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
vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: (key: string | null) => (key ? `https://cdn.test/${key}` : null),
  resignStoredAssetUrl: (src: string) =>
    src.includes('/api/storage/') && !src.includes('read=') ? `${src}?read=live` : src,
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
const {
  getWorkspaceSettings,
  updateAuthConfig,
  updatePortalConfig,
  updateDeveloperConfig,
  updateFeatureFlags,
} = await import('../settings.service')
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
// getWorkspaceSettings caching
// ============================================================================

describe('getWorkspaceSettings', () => {
  it('returns cached result on cache hit without querying DB', async () => {
    const cached = {
      name: 'Cached Workspace',
      slug: 'cached',
      settings: makeSettingsRow({
        name: 'Cached Workspace',
        setupState: JSON.stringify({
          version: 2,
          steps: {
            core: true,
            workspace: true,
            startingPoint: {
              outcome: 'product_feedback',
              resourceType: 'none',
              source: 'managed',
              resolution: 'configured',
              completedAt: '2026-08-13T00:00:00.000Z',
            },
          },
        }),
      }),
    }
    mockCacheGet.mockResolvedValue(cached)

    const result = await getWorkspaceSettings()

    expect(result).toEqual(cached)
    expect(mockCacheGet).toHaveBeenCalledWith('settings:workspace')
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('remints welcome-card storage srcs on a cache hit without writing them back', async () => {
    const unsigned = '/api/storage/uploads/logo.png'
    const cached = {
      name: 'Cached Workspace',
      slug: 'cached',
      settings: makeSettingsRow({
        name: 'Cached Workspace',
        setupState: JSON.stringify({
          version: 2,
          steps: {
            core: true,
            workspace: true,
            startingPoint: {
              outcome: 'product_feedback',
              resourceType: 'none',
              source: 'managed',
              resolution: 'configured',
              completedAt: '2026-08-13T00:00:00.000Z',
            },
          },
        }),
      }),
      publicPortalConfig: {
        welcomeCard: {
          body: {
            type: 'doc',
            content: [{ type: 'image', attrs: { src: unsigned } }],
          },
        },
      },
    }
    mockCacheGet.mockResolvedValue(cached)

    const result = await getWorkspaceSettings()

    expect(result?.publicPortalConfig.welcomeCard?.body.content?.[0]?.attrs?.src).toBe(
      `${unsigned}?read=live`
    )
    expect(cached.publicPortalConfig.welcomeCard.body.content[0].attrs.src).toBe(unsigned)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('ignores a cache hit whose setup is still unfinished, so a bootstrap stamp is visible', async () => {
    mockCacheGet.mockResolvedValue({
      name: 'Cached Workspace',
      slug: 'cached',
      settings: makeSettingsRow({ name: 'Cached Workspace', setupState: null }),
    })
    mockFindFirst.mockResolvedValue(
      makeSettingsRow({
        setupState: JSON.stringify({
          version: 2,
          steps: {
            core: true,
            workspace: true,
            startingPoint: {
              outcome: 'product_feedback',
              resourceType: 'none',
              source: 'managed',
              resolution: 'configured',
              completedAt: '2026-08-13T00:00:00.000Z',
            },
          },
        }),
      })
    )

    const result = await getWorkspaceSettings()

    expect(mockFindFirst).toHaveBeenCalled()
    expect(result?.settings.setupState).toContain('"version":2')
  })

  it('queries DB and caches result on cache miss', async () => {
    mockCacheGet.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue(makeSettingsRow())

    const result = await getWorkspaceSettings()

    expect(result).not.toBeNull()
    expect(mockFindFirst).toHaveBeenCalled()
    expect(mockCacheSet).toHaveBeenCalledWith(
      'settings:workspace',
      expect.objectContaining({ name: 'Test Workspace' }),
      3600
    )
  })

  it('returns null when no settings exist (does not cache null)', async () => {
    mockCacheGet.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue(null)

    const result = await getWorkspaceSettings()

    expect(result).toBeNull()
    expect(mockCacheSet).not.toHaveBeenCalled()
  })
})

// ============================================================================
// invalidateSettingsCache
// ============================================================================

describe('invalidateSettingsCache', () => {
  it('deletes the workspace settings cache key', async () => {
    await invalidateSettingsCache()

    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
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
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('updatePortalConfig invalidates cache', async () => {
    await updatePortalConfig({ features: {} })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('updateBrandingConfig invalidates cache', async () => {
    await updateBrandingConfig({ preset: 'custom' })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('updateCustomCss invalidates cache', async () => {
    await updateCustomCss('.test { color: red; }')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('updateDeveloperConfig invalidates cache', async () => {
    await updateDeveloperConfig({ mcpEnabled: true })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('updateWidgetConfig invalidates cache', async () => {
    await updateWidgetConfig({ enabled: true })
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('updateWorkspaceName invalidates cache', async () => {
    await updateWorkspaceName('New Name')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('updateHeaderDisplayMode invalidates cache', async () => {
    await updateHeaderDisplayMode('logo_only')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('updateHeaderDisplayName invalidates cache', async () => {
    await updateHeaderDisplayName('Custom Name')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('saveLogoKey invalidates cache', async () => {
    await saveLogoKey('logos/new.png')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('deleteLogoKey invalidates cache', async () => {
    await deleteLogoKey()
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('deleteLogoKey clears the derived favicon too', async () => {
    mockFindFirst.mockResolvedValue(
      makeSettingsRow({ logoKey: 'logos/a.png', faviconKey: 'favicons/a.png' })
    )
    await deleteLogoKey()
    expect(mockSet).toHaveBeenCalledWith({ logoKey: null, faviconKey: null })
  })

  it('saveFaviconKey invalidates cache', async () => {
    await saveFaviconKey('favicons/new.ico')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('deleteFaviconKey invalidates cache', async () => {
    await deleteFaviconKey()
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('saveHeaderLogoKey invalidates cache', async () => {
    await saveHeaderLogoKey('headers/new.png')
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('deleteHeaderLogoKey invalidates cache', async () => {
    await deleteHeaderLogoKey()
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })

  it('regenerateWidgetSecret invalidates cache', async () => {
    await regenerateWidgetSecret()
    expect(mockCacheDel).toHaveBeenCalledWith('settings:workspace', 'auth:registered-providers')
  })
})

describe('updateFeatureFlags', () => {
  beforeEach(() => {
    mockFindFirst.mockResolvedValue(
      makeSettingsRow({
        featureFlags: JSON.stringify({
          feedback: true,
          changelog: true,
          helpCenter: false,
          supportInbox: false,
          supportTickets: false,
          statusPage: false,
        }),
        metadata: null,
      })
    )
  })

  it('refuses to persist feedback: false', async () => {
    const result = await updateFeatureFlags({ feedback: false })
    expect(result.feedback).toBe(true)
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        featureFlags: expect.stringMatching(/"feedback":true/),
      })
    )
    const written = JSON.parse(
      (
        mockSet.mock.calls.find((call) => call[0] && 'featureFlags' in call[0]) as
          [{ featureFlags: string }] | undefined
      )?.[0].featureFlags ?? '{}'
    ) as { feedback?: boolean }
    expect(written.feedback).toBe(true)
  })

  it('writes statusSettings.enabled true when turning Status on', async () => {
    await updateFeatureFlags({ statusPage: true })
    const metadataCall = mockSet.mock.calls.find((call) => call[0] && 'metadata' in call[0]) as
      [{ metadata: string }] | undefined
    expect(metadataCall).toBeTruthy()
    const meta = JSON.parse(metadataCall![0].metadata) as {
      statusSettings?: { enabled?: boolean }
    }
    expect(meta.statusSettings?.enabled).toBe(true)
  })

  it('does not write statusSettings.enabled when turning Status off', async () => {
    mockFindFirst.mockResolvedValue(
      makeSettingsRow({
        featureFlags: JSON.stringify({
          feedback: true,
          changelog: true,
          helpCenter: false,
          supportInbox: false,
          supportTickets: false,
          statusPage: true,
        }),
        metadata: JSON.stringify({ statusSettings: { enabled: true } }),
      })
    )
    await updateFeatureFlags({ statusPage: false })
    const metadataCall = mockSet.mock.calls.find((call) => call[0] && 'metadata' in call[0])
    expect(metadataCall).toBeUndefined()
  })
})
