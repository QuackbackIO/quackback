/**
 * Per-key auth-config managed-paths gate.
 *
 * updateAuthConfig() lives in settings.service alongside the
 * getTenantSettings() helper that assertNotManaged() reads. The gate
 * imports getTenantSettings() dynamically, so when we test from inside
 * settings.service we stub `assertNotManaged` directly rather than
 * trying to mock the dynamic import-out-of-self.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ForbiddenError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  mockRequireSettings: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockAssertNotManaged: vi.fn(),
  mockGetTierLimits: vi.fn(),
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

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

import { updateAuthConfig } from '../settings.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('updateAuthConfig — per-key managed-paths gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x', authConfig: null })
    hoisted.mockDbUpdate.mockReturnValue({ set: () => ({ where: vi.fn() }) })
    hoisted.mockGetTierLimits.mockResolvedValue(OSS_TIER_LIMITS)
  })

  it('asserts each oauth provider key, prefixed with auth.oauth.', async () => {
    hoisted.mockAssertNotManaged.mockResolvedValue(undefined)
    await updateAuthConfig({ oauth: { google: true, github: false } })
    const calls = hoisted.mockAssertNotManaged.mock.calls.map((c) => c[0])
    expect(calls).toContain('auth.oauth.google')
    expect(calls).toContain('auth.oauth.github')
  })

  it('asserts auth.openSignup when input includes openSignup', async () => {
    hoisted.mockAssertNotManaged.mockResolvedValue(undefined)
    await updateAuthConfig({ openSignup: true })
    const calls = hoisted.mockAssertNotManaged.mock.calls.map((c) => c[0])
    expect(calls).toContain('auth.openSignup')
  })

  it('throws ForbiddenError when an oauth key is locked, before any DB write', async () => {
    hoisted.mockAssertNotManaged.mockImplementation(async (path: string) => {
      if (path === 'auth.oauth.google') {
        throw new ForbiddenError('FIELD_MANAGED', `Field "${path}" is managed`)
      }
    })
    await expect(updateAuthConfig({ oauth: { google: true } })).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('throws ForbiddenError when openSignup is locked, before any DB write', async () => {
    hoisted.mockAssertNotManaged.mockImplementation(async (path: string) => {
      if (path === 'auth.openSignup') {
        throw new ForbiddenError('FIELD_MANAGED', `Field "${path}" is managed`)
      }
    })
    await expect(updateAuthConfig({ openSignup: true })).rejects.toBeInstanceOf(ForbiddenError)
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('writes through when no key is locked', async () => {
    hoisted.mockAssertNotManaged.mockResolvedValue(undefined)
    await expect(
      updateAuthConfig({ oauth: { google: true }, openSignup: false })
    ).resolves.toBeDefined()
  })
})
