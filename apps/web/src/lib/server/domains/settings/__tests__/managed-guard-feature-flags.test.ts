/**
 * Per-key feature-flag managed-paths gate.
 *
 * updateFeatureFlags() lives in settings.service alongside the
 * getTenantSettings() helper that assertNotManaged() reads. The gate
 * imports getTenantSettings() dynamically, so this test stubs
 * `assertNotManaged` directly rather than trying to mock a dynamic
 * import-out-of-self.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ForbiddenError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  mockRequireSettings: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockAssertNotManaged: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: { update: hoisted.mockDbUpdate },
  settings: { id: 'id' },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/redis', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  CACHE_KEYS: { SETTINGS: 's' },
}))

vi.mock('../settings.helpers', () => ({
  requireSettings: hoisted.mockRequireSettings,
  parseJsonConfig: <T>(_raw: string | null, def: T): T => def,
  parseJsonOrNull: () => null,
  invalidateSettingsCache: vi.fn(),
  wrapDbError: (_msg: string, err: unknown) => {
    throw err
  },
  deepMerge: <T>(a: T, b: Partial<T>) => ({ ...a, ...b }),
}))

vi.mock('@/lib/server/config-file/managed-guard', () => ({
  assertNotManaged: hoisted.mockAssertNotManaged,
}))

import { updateFeatureFlags } from '../settings.service'

describe('updateFeatureFlags — per-key managed-paths gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x', featureFlags: null })
    hoisted.mockDbUpdate.mockReturnValue({ set: () => ({ where: vi.fn() }) })
  })

  it('asserts every input key, prefixed with features.', async () => {
    hoisted.mockAssertNotManaged.mockResolvedValue(undefined)
    await updateFeatureFlags({ analytics: true, helpCenter: false })
    const calls = hoisted.mockAssertNotManaged.mock.calls.map((c) => c[0])
    expect(calls).toContain('features.analytics')
    expect(calls).toContain('features.helpCenter')
  })

  it('throws when one of the keys is locked, before any DB write', async () => {
    hoisted.mockAssertNotManaged.mockImplementation(async (path: string) => {
      if (path === 'features.helpCenter') {
        throw new ForbiddenError('FIELD_MANAGED', `Field "${path}" is managed`)
      }
    })
    await expect(updateFeatureFlags({ analytics: true, helpCenter: false })).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('writes through when no input key is locked', async () => {
    hoisted.mockAssertNotManaged.mockResolvedValue(undefined)
    const result = await updateFeatureFlags({ analytics: true })
    expect(result.analytics).toBe(true)
  })
})
