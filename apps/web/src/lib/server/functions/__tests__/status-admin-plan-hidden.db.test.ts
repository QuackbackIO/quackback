/**
 * The admin services list against a real database: it keeps every service,
 * and once the plan hides some (past the cap, after the grace) it names them
 * so the list can mark them. Nothing is marked in the grace or with the rules
 * off.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type StatusComponentId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, isNull, settings, statusComponents } from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  // A server function is its handler here, so the test calls it directly.
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: () => Promise<unknown>) => fn,
    }
    return chain
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', async (original) => ({
  ...(await original<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: async () => ({}),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import {
  getPlanLimits,
  invalidatePlanLimits,
} from '@/lib/server/domains/plan-limits/plan-limits.service'
import { planBillingOn } from '@/lib/server/domains/plan-limits/__tests__/plan-billing'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

type AdminList = {
  ungrouped: { id: string }[]
  planHidden: { ids: string[] } | null
}
const { listStatusComponentsAdminFn } = await import('../status')
const list = async () =>
  (await (listStatusComponentsAdminFn as unknown as () => Promise<unknown>)()) as AdminList

let api: StatusComponentId
let web: StatusComponentId

/** `planBilling` off is an install without plan billing. */
async function configure(planBilling: boolean) {
  await testDb.update(settings).set({
    cloud: (planBilling ? planBillingOn() : null) as never,
    tierLimits: JSON.stringify({ ...OSS_TIER_LIMITS, maxStatusComponents: 1 }),
  })
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
  await getPlanLimits()
}

describe.skipIf(!fixture.available)('admin services list and plan limits (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (!row) {
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    }
    await testDb.update(settings).set({ planLimitsState: null })
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    await testDb
      .update(statusComponents)
      .set({ deletedAt: new Date() })
      .where(isNull(statusComponents.deletedAt))
    const rows = await testDb
      .insert(statusComponents)
      .values([
        { name: 'Acme API', position: 0, status: 'operational' },
        { name: 'Acme Web', position: 1, status: 'operational' },
      ])
      .returning({ id: statusComponents.id })
    api = rows[0]!.id as StatusComponentId
    web = rows[1]!.id as StatusComponentId
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('lists every service and marks only the one the plan hides, once enforced', async () => {
    await configure(true)
    expect((await list()).planHidden).toBeNull()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    await invalidatePlanLimits()
    const enforced = await list()
    expect(enforced.ungrouped.map((c) => c.id).sort()).toEqual([api, web].sort())
    expect(enforced.planHidden?.ids).toEqual([web])
  })

  it('marks nothing without plan billing', async () => {
    await configure(false)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    const off = await list()
    expect(off.ungrouped).toHaveLength(2)
    expect(off.planHidden).toBeNull()
  })
})
