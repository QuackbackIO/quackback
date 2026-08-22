/**
 * Portal OG image settings tests.
 *
 * The stored `portal_og_image_key` column is leftover and unread.
 * Social share resolves to the workspace logo (then `/logo.png`).
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
const { getWorkspaceSettings } = await import('../settings.service')

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

describe('getWorkspaceSettings brandingData.ogImageUrl', () => {
  it('does not read a leftover stored portal_og_image_key', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow({ portalOgImageKey: 'portal-og/og.png' }))

    const result = await getWorkspaceSettings()

    expect(result?.brandingData.ogImageUrl).toBeNull()
  })

  it('is null when no OG image is set', async () => {
    mockFindFirst.mockResolvedValue(makeSettingsRow())

    const result = await getWorkspaceSettings()

    expect(result?.brandingData.ogImageUrl).toBeNull()
  })
})
