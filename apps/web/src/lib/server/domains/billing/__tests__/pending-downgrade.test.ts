import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { CloudConfig } from '@/lib/server/domains/settings/cloud/cloud.types'

const hoisted = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  cloud: null as unknown as CloudConfig,
}))

vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: async (key: string) => hoisted.kv.get(key) ?? null,
  kvSet: async (key: string, value: unknown) => void hoisted.kv.set(key, value),
  kvDel: async (key: string) => void hoisted.kv.delete(key),
}))

vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: async () => hoisted.cloud,
}))

const { shouldLockAdminToBilling, setPendingDowngrade, getPendingDowngrade } =
  await import('../pending-downgrade')

const MANAGER = [PERMISSIONS.MEMBER_VIEW, PERMISSIONS.BILLING_MANAGE]
const MEMBER = [PERMISSIONS.MEMBER_VIEW]
const EXPIRED = '2026-08-19T12:00:00.000Z'
const hours = (n: number) => new Date(Date.parse(EXPIRED) + n * 3_600_000)

function cloud(overrides: Partial<CloudConfig> = {}): CloudConfig {
  return {
    enabled: true,
    plan: 'free',
    entitlements: {},
    subscriptionStatus: null,
    trialStartedAt: '2026-08-05T12:00:00.000Z',
    trialExpiresAt: EXPIRED,
    trialActive: false,
    canUpgrade: true,
    canManageBilling: false,
    renewalAt: null,
    cancellationAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  hoisted.kv.clear()
  hoisted.cloud = cloud()
})

describe('shouldLockAdminToBilling after a trial ends', () => {
  it('leaves admin open for two days, then holds billing managers on the plan picker', async () => {
    expect(await shouldLockAdminToBilling('/admin/feedback', MANAGER, hours(47))).toBe(false)
    expect(await shouldLockAdminToBilling('/admin/feedback', MANAGER, hours(48))).toBe(true)
    expect(await shouldLockAdminToBilling('/admin/settings/boards', MANAGER, hours(48))).toBe(true)
    expect(await shouldLockAdminToBilling('/admin/settings/billing', MANAGER, hours(48))).toBe(
      false
    )
  })

  it('never holds a teammate who cannot choose', async () => {
    expect(await shouldLockAdminToBilling('/admin/feedback', MEMBER, hours(72))).toBe(false)
  })

  it('does not hold anyone once Free closed the trial or a plan was bought', async () => {
    hoisted.cloud = cloud({ trialExpiresAt: null })
    expect(await shouldLockAdminToBilling('/admin/feedback', MANAGER, hours(72))).toBe(false)
    hoisted.cloud = cloud({ plan: 'pro', subscriptionStatus: 'active' })
    expect(await shouldLockAdminToBilling('/admin/feedback', MANAGER, hours(72))).toBe(false)
  })

  it('does not gate a workspace whose plan picker cannot act', async () => {
    hoisted.cloud = cloud({ canUpgrade: false })
    expect(await shouldLockAdminToBilling('/admin/feedback', MANAGER, hours(72))).toBe(false)
  })

  it('keeps a Free choice made over the limits, and opens its clean-up pages', async () => {
    // Regression: an ended trial already resolves to Free, so the stale check
    // compared Free with Free and dropped this lock on the next navigation.
    await setPendingDowngrade('free')
    expect(await shouldLockAdminToBilling('/admin/roadmap', MANAGER, hours(1))).toBe(true)
    expect(await shouldLockAdminToBilling('/admin/settings/boards', MANAGER, hours(72))).toBe(false)
    expect(await getPendingDowngrade()).toEqual({ planId: 'free' })
  })
})

describe('shouldLockAdminToBilling for a paid plan', () => {
  it('drops a pending downgrade once the workspace sits on the new plan', async () => {
    hoisted.cloud = cloud({ trialExpiresAt: null, trialStartedAt: null })
    await setPendingDowngrade('free')
    expect(await shouldLockAdminToBilling('/admin/roadmap', MANAGER, hours(1))).toBe(false)
    expect(await getPendingDowngrade()).toBeNull()
  })

  it('holds while the workspace is still above the plan it is moving to', async () => {
    hoisted.cloud = cloud({ plan: 'pro', subscriptionStatus: 'active', trialExpiresAt: null })
    await setPendingDowngrade('free')
    expect(await shouldLockAdminToBilling('/admin/roadmap', MANAGER, hours(1))).toBe(true)
  })
})
