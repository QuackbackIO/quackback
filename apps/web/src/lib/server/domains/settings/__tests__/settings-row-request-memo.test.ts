/**
 * The two tiers of the settings row.
 *
 * Read-only getters (office hours, stage labels, changelog settings, the raw
 * cached row, the parsed workspace settings) all share one read per request,
 * whichever of them asks first, and each caller still gets a copy of its own.
 * A write reads the row fresh and merges over what is stored, never over a
 * cached copy, and a save is seen by the request that made it and by the next
 * one. Driven through the real cache layer and request memo; only the kv and
 * database statements are faked, over one stored row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const kvRows = new Map<string, unknown>()
const mockKvGet = vi.fn(async (key: string) => structuredClone(kvRows.get(key) ?? null))
vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: (key: string) => mockKvGet(key),
  kvSet: vi.fn(async (key: string, value: unknown) => void kvRows.set(key, value)),
  kvDel: vi.fn(async (...keys: string[]) => keys.forEach((k) => kvRows.delete(k))),
}))

// The one stored settings row: reads copy it, writes patch it.
let stored: Record<string, unknown> | undefined
const mockFindFirst = vi.fn(async () => (stored ? structuredClone(stored) : undefined))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { settings: { findFirst: () => mockFindFirst() } },
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => void Object.assign(stored!, patch),
      }),
    }),
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
const { getOfficeHoursSchedule } = await import('../settings.office-hours')
const { getStageLabels, setStageLabels } = await import('../settings.tickets')
const { getChangelogSettings, updateChangelogSettings } = await import('../settings.changelog')
const { requireSettings, requireSettingsCached, findSettingsCached } =
  await import('../settings.helpers')
const { runWithLogContext } = await import('@/lib/server/log-context')
const { forgetCachedKeys } = await import('@/lib/server/local-cache')

// A finished setup, so a cached copy is trusted rather than re-read.
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

function row(metadata: Record<string, unknown> | null = null) {
  return {
    id: 'settings_1',
    name: 'Acme',
    slug: 'acme',
    setupState: COMPLETE_SETUP,
    metadata: metadata ? JSON.stringify(metadata) : null,
    assistantConfig: { identity: { name: 'Quinn' } },
  }
}

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return runWithLogContext({ request_id: crypto.randomUUID() }, fn)
}

beforeEach(() => {
  vi.clearAllMocks()
  forgetCachedKeys('settings:workspace')
  kvRows.clear()
  stored = row()
})

describe('the cached settings row within a request', () => {
  it('is read once whichever entry point asks', async () => {
    await inRequest(async () => {
      await Promise.all([getWorkspaceSettings(), getStageLabels(), requireSettingsCached()])
      await Promise.all([findSettingsCached(), getOfficeHoursSchedule(), getWorkspaceSettings()])
    })
    expect(mockKvGet).toHaveBeenCalledTimes(1)
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
  })

  it('hands every caller a copy of its own', async () => {
    const second = await inRequest(async () => {
      const first = await requireSettingsCached()
      first.name = 'mutated by a caller'
      ;(first.assistantConfig as { identity: { name: string } }).identity.name = 'mutated'
      return requireSettingsCached()
    })
    expect(second.name).toBe('Acme')
    expect(second.assistantConfig).toEqual({ identity: { name: 'Quinn' } })
  })

  it('stays a fresh read for a read-modify-write', async () => {
    await inRequest(async () => {
      await requireSettingsCached()
      await requireSettings()
      await requireSettings()
    })
    expect(mockFindFirst).toHaveBeenCalledTimes(3)
  })

  it('is not shared outside a request', async () => {
    await getOfficeHoursSchedule()
    await getOfficeHoursSchedule()
    expect(mockKvGet).toHaveBeenCalledTimes(2)
  })

  it('is missing before the workspace has a settings row', async () => {
    stored = undefined
    expect(await inRequest(() => findSettingsCached())).toBeNull()
    await expect(inRequest(() => requireSettingsCached())).rejects.toMatchObject({
      code: 'SETTINGS_NOT_FOUND',
    })
  })
})

describe('the cached settings row across requests, in production', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('hands every request a copy of its own', async () => {
    await inRequest(async () => {
      const first = await requireSettingsCached()
      ;(first.assistantConfig as { identity: { name: string } }).identity.name = 'mutated'
    })
    const next = await inRequest(() => requireSettingsCached())
    expect(next.assistantConfig).toEqual({ identity: { name: 'Quinn' } })
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
  })

  it('shows a save to the request that made it and to the next one', async () => {
    const sameRequest = await inRequest(async () => {
      expect((await getStageLabels()).resolved).not.toBe('Fixed')
      await setStageLabels({ resolved: 'Fixed' })
      return (await getStageLabels()).resolved
    })
    expect(sameRequest).toBe('Fixed')
    expect((await inRequest(() => getStageLabels())).resolved).toBe('Fixed')
    expect((await inRequest(() => requireSettingsCached())).metadata).toBe(stored!.metadata)
  })

  it('merges a partial update over the stored row, not over a cached copy', async () => {
    stored = row({ changelogSettings: { autoSubscribe: false } })
    // This process caches the row, then another process changes it.
    expect((await inRequest(() => getChangelogSettings())).autoSubscribe).toBe(false)
    stored = row({ changelogSettings: { autoSubscribe: true } })
    expect((await inRequest(() => getChangelogSettings())).autoSubscribe).toBe(false)

    const saved = await inRequest(() => updateChangelogSettings({ emailsDisabled: true }))

    expect(saved).toMatchObject({ autoSubscribe: true, emailsDisabled: true })
    expect(JSON.parse(stored!.metadata as string).changelogSettings).toMatchObject({
      autoSubscribe: true,
      emailsDisabled: true,
    })
  })
})
