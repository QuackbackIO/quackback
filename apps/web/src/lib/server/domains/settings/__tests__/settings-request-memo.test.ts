/**
 * getWorkspaceSettings reads once per request.
 *
 * The auth instance's version check, its after-hook, the bootstrap payload and
 * the auth helpers each ask for the workspace settings on every authenticated
 * request. Driven through the real cache layer (only the key-value statements
 * are faked), these tests prove one read serves the request, each caller still
 * gets a copy of its own, an invalidation in the same request is honoured, and
 * the next request reads again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const kvRows = new Map<string, unknown>()
const mockKvGet = vi.fn(async (key: string) => structuredClone(kvRows.get(key) ?? null))
vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: (key: string) => mockKvGet(key),
  kvSet: vi.fn(async (key: string, value: unknown) => void kvRows.set(key, value)),
  kvDel: vi.fn(async (...keys: string[]) => keys.forEach((k) => kvRows.delete(k))),
}))

const mockFindFirst = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { settings: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } },
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
        limit: () => Promise.resolve([]),
        orderBy: () => Promise.resolve([]),
      }),
    }),
  },
}))

vi.mock('@/lib/server/auth/config-version', () => ({ bumpAuthConfigVersionInTx: vi.fn() }))
vi.mock('@/lib/server/auth', () => ({ resetAuth: vi.fn() }))
vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: (key: string | null) => (key ? `https://cdn.test/${key}` : null),
  resignStoredAssetUrl: (src: string) => src,
  deleteObject: vi.fn(),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: vi.fn().mockResolvedValue(new Set()),
  getPlatformCredentials: vi.fn().mockResolvedValue(null),
}))
vi.mock('@quackback/email', () => ({ isEmailConfigured: vi.fn().mockReturnValue(false) }))
vi.mock('@/lib/server/auth/auth-providers', () => ({
  getAllAuthProviders: vi.fn().mockReturnValue([]),
}))

const { getWorkspaceSettings } = await import('../settings.service')
const { invalidateSettingsCache } = await import('../settings.helpers')
const { runWithLogContext } = await import('@/lib/server/log-context')

const COMPLETE_SETUP = JSON.stringify({
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
})

function cachedSettings(name: string) {
  return {
    name,
    slug: 'ws',
    visualTheme: 'legacy' as const,
    featureFlags: { feedback: true },
    settings: { id: 'settings_1', name, setupState: COMPLETE_SETUP },
  }
}

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return runWithLogContext({ request_id: crypto.randomUUID() }, fn)
}

beforeEach(() => {
  vi.clearAllMocks()
  kvRows.clear()
  kvRows.set('settings:workspace', cachedSettings('First'))
})

describe('getWorkspaceSettings within a request', () => {
  it('reads the cached settings once however many callers ask', async () => {
    const names = await inRequest(async () => {
      const [a, b] = await Promise.all([getWorkspaceSettings(), getWorkspaceSettings()])
      const c = await getWorkspaceSettings()
      return [a?.name, b?.name, c?.name]
    })
    expect(names).toEqual(['First', 'First', 'First'])
    expect(mockKvGet).toHaveBeenCalledTimes(1)
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('hands every caller a copy of its own', async () => {
    const second = await inRequest(async () => {
      const first = await getWorkspaceSettings()
      first!.name = 'mutated by a caller'
      first!.featureFlags.feedback = false
      return getWorkspaceSettings()
    })
    expect(second?.name).toBe('First')
    expect(second?.featureFlags.feedback).toBe(true)
  })

  it('reads again after an invalidation in the same request', async () => {
    const names = await inRequest(async () => {
      const before = await getWorkspaceSettings()
      // A rename: the row changes and the writer invalidates the cache.
      mockFindFirst.mockResolvedValue({
        id: 'settings_1',
        name: 'Renamed',
        slug: 'ws',
        setupState: COMPLETE_SETUP,
      })
      await invalidateSettingsCache()
      const after = await getWorkspaceSettings()
      return [before?.name, after?.name]
    })
    expect(names).toEqual(['First', 'Renamed'])
    expect(mockKvGet).toHaveBeenCalledTimes(2)
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
  })

  it('reads again in the next request', async () => {
    await inRequest(() => getWorkspaceSettings())
    kvRows.set('settings:workspace', cachedSettings('Later'))
    const later = await inRequest(() => getWorkspaceSettings())
    expect(later?.name).toBe('Later')
    expect(mockKvGet).toHaveBeenCalledTimes(2)
  })
})
