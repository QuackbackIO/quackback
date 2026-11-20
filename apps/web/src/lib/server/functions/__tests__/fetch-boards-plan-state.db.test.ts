/**
 * The admin boards list against a real database: it labels the boards the plan
 * keeps read-only and says when the board count is at the cap, and a failed
 * plan limits read never takes the list down (it fails open, like every other
 * plan limits read).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, isNull, settings } from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

const hoisted = vi.hoisted(() => ({ usageFails: false }))

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
vi.mock('@/lib/server/domains/billing/usage-counts', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/billing/usage-counts')>()
  return {
    ...real,
    loadUsageCounts: async (...args: Parameters<typeof real.loadUsageCounts>) => {
      if (hoisted.usageFails) throw new Error('usage count failed')
      return real.loadUsageCounts(...args)
    },
  }
})

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import {
  getPlanLimits,
  invalidatePlanLimits,
} from '@/lib/server/domains/plan-limits/plan-limits.service'
import { fetchBoardsWithCountsFn } from '../boards'
import { planBillingOn } from '@/lib/server/domains/plan-limits/__tests__/plan-billing'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

type Row = { id: string; planReadOnly?: string; atCap?: { cap: number } }
const list = async () =>
  (await (fetchBoardsWithCountsFn as unknown as () => Promise<unknown>)()) as Row[]

let openBoard: BoardId
let closedBoard: BoardId

/** `planBilling` off is an install without plan billing. */
async function configure(planBilling: boolean) {
  await testDb.update(settings).set({
    cloud: (planBilling ? planBillingOn() : null) as never,
    tierLimits: JSON.stringify({ ...OSS_TIER_LIMITS, maxBoards: 1 }),
  })
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
}

describe.skipIf(!fixture.available)('admin boards list and plan limits (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.useRealTimers()
    hoisted.usageFails = false
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    if (!row) {
      await testDb
        .insert(settings)
        .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
    }
    await testDb.update(settings).set({ planLimitsState: null })
    await testDb.update(boards).set({ deletedAt: new Date() }).where(isNull(boards.deletedAt))
    openBoard = createId('board') as BoardId
    closedBoard = createId('board') as BoardId
    await testDb.insert(boards).values([
      {
        id: openBoard,
        name: 'Acme open',
        slug: String(openBoard),
        createdAt: new Date('2026-01-01'),
      },
      {
        id: closedBoard,
        name: 'Acme closed',
        slug: String(closedBoard),
        createdAt: new Date('2026-02-01'),
      },
    ])
  })
  afterEach(async () => {
    vi.useRealTimers()
    hoisted.usageFails = false
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('labels only the board the plan keeps read-only, once enforced', async () => {
    await configure(true)
    await getPlanLimits()
    expect((await list()).every((b) => b.planReadOnly === undefined)).toBe(true)
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 8 * DAY })
    const rows = await list()
    expect(rows.find((b) => b.id === closedBoard)?.planReadOnly).toBeDefined()
    expect(rows.find((b) => b.id === openBoard)?.planReadOnly).toBeUndefined()
    expect(rows[0]?.atCap).toMatchObject({ cap: 1 })
  })

  it('labels nothing and reports no cap without plan billing', async () => {
    await configure(false)
    const rows = await list()
    expect(rows).toHaveLength(2)
    expect(rows.every((b) => b.planReadOnly === undefined && b.atCap === undefined)).toBe(true)
  })

  it('still lists every board when the plan limits read fails', async () => {
    await configure(true)
    hoisted.usageFails = true
    const rows = await list()
    expect(rows.map((b) => b.id).sort()).toEqual([openBoard, closedBoard].sort())
    expect(rows.every((b) => b.planReadOnly === undefined)).toBe(true)
  })
})
