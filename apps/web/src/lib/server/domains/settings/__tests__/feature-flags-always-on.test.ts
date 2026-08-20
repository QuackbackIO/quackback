/**
 * Feedback & Roadmaps is load-bearing for the portal: its homepage is the
 * feedback board, so a workspace with the flag off has no portal root. The
 * Settings switch is fixed on, but a UI-only lock is no lock — these tests
 * pin the server-side half, which is what an API or server-fn caller hits.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  mockRequireSettings: vi.fn(),
  mockSet: vi.fn((_payload: { featureFlags: string }) => ({ where: vi.fn(async () => undefined) })),
  mockDbUpdate: vi.fn(() => ({ set: hoisted.mockSet })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { update: hoisted.mockDbUpdate },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  CACHE_KEYS: { SETTINGS: 's' },
}))

vi.mock('../settings.helpers', () => ({
  requireSettings: hoisted.mockRequireSettings,
  parseJsonConfig: <T>(_raw: string | null, def: T): T => def,
  invalidateSettingsCache: vi.fn(),
  wrapDbError: (_msg: string, err: unknown) => {
    throw err
  },
  deepMerge: <T>(a: T, b: Partial<T>) => ({ ...a, ...b }),
}))

import { updateFeatureFlags } from '../settings.service'
import {
  ALWAYS_ON_FEATURE_FLAGS,
  DEFAULT_FEATURE_FLAGS,
  findDisabledAlwaysOnFlag,
  getProductAlwaysOnReason,
  resolveFeatureFlags,
  type FeatureFlags,
} from '../settings.types'

/** The flags JSON the write attempt would have persisted, or null if it never wrote. */
function persistedFlags(): FeatureFlags | null {
  const call = hoisted.mockSet.mock.calls.at(-1)
  if (!call) return null
  return JSON.parse(call[0].featureFlags) as FeatureFlags
}

describe('always-on product flags', () => {
  it('locks Feedback & Roadmaps and nothing else', () => {
    expect([...ALWAYS_ON_FEATURE_FLAGS]).toEqual(['feedback'])
    expect(getProductAlwaysOnReason('feedback')).toBeTruthy()
    for (const productId of ['support', 'helpCenter', 'changelog', 'status'] as const) {
      expect(getProductAlwaysOnReason(productId)).toBeNull()
    }
  })

  it('defaults the feedback flag on for a new workspace', () => {
    expect(DEFAULT_FEATURE_FLAGS.feedback).toBe(true)
  })

  it('spots an update that switches a locked flag off, and only that', () => {
    expect(findDisabledAlwaysOnFlag({ feedback: false })).toBe('feedback')
    expect(findDisabledAlwaysOnFlag({ feedback: true })).toBeNull()
    expect(findDisabledAlwaysOnFlag({ changelog: false })).toBeNull()
    expect(findDisabledAlwaysOnFlag({})).toBeNull()
  })

  it('reads a row that already stores feedback:false back as on', () => {
    // Covers workspaces that turned the product off before the lock existed,
    // which is why no data migration is needed to restore the invariant.
    const flags = resolveFeatureFlags(JSON.stringify({ feedback: false, changelog: false }))
    expect(flags.feedback).toBe(true)
    // Healing is scoped to locked flags: everything else still honours storage.
    expect(flags.changelog).toBe(false)
  })
})

describe('updateFeatureFlags — always-on guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockSet.mockReturnValue({ where: vi.fn(async () => undefined) })
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x', featureFlags: null })
  })

  it('refuses a partial update that disables feedback, and writes nothing', async () => {
    const refusal = await updateFeatureFlags({ feedback: false }).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(ValidationError)
    expect((refusal as ValidationError).code).toBe('PRODUCT_ALWAYS_ENABLED')
    expect((refusal as ValidationError).statusCode).toBe(400)
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
    expect(persistedFlags()).toBeNull()
  })

  it('refuses a whole-object write that carries feedback:false', async () => {
    // An API caller sending the full flag set must not sneak the flag off
    // just because the other keys are legitimate.
    await expect(
      updateFeatureFlags({ ...DEFAULT_FEATURE_FLAGS, feedback: false, helpCenter: true })
    ).rejects.toBeInstanceOf(ValidationError)
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('refuses even when the stored row already has feedback off', async () => {
    hoisted.mockRequireSettings.mockResolvedValue({
      id: 'org_x',
      featureFlags: JSON.stringify({ feedback: false }),
    })
    await expect(updateFeatureFlags({ feedback: false })).rejects.toBeInstanceOf(ValidationError)
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('persists feedback:true alongside an unrelated product change', async () => {
    const updated = await updateFeatureFlags({ helpCenter: true })

    expect(updated.helpCenter).toBe(true)
    expect(updated.feedback).toBe(true)
    expect(persistedFlags()).toMatchObject({ feedback: true, helpCenter: true })
  })

  it('heals a stored feedback:false on the next unrelated write', async () => {
    hoisted.mockRequireSettings.mockResolvedValue({
      id: 'org_x',
      featureFlags: JSON.stringify({ feedback: false }),
    })

    const updated = await updateFeatureFlags({ statusPage: true })

    expect(updated.feedback).toBe(true)
    expect(persistedFlags()).toMatchObject({ feedback: true, statusPage: true })
  })

  it('still allows explicitly setting feedback on', async () => {
    await expect(updateFeatureFlags({ feedback: true })).resolves.toMatchObject({ feedback: true })
    expect(hoisted.mockDbUpdate).toHaveBeenCalled()
  })

  it('still allows turning an unlocked product off', async () => {
    const updated = await updateFeatureFlags({ changelog: false })
    expect(updated.changelog).toBe(false)
    expect(persistedFlags()).toMatchObject({ changelog: false, feedback: true })
  })
})
