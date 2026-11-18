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

type Handler = () => Promise<unknown>
const hoisted = vi.hoisted(() => ({ handlers: [] as Handler[], usageFails: false }))

vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler(fn: Handler) {
        hoisted.handlers.push(fn)
        return chain
      },
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

const fixture = await createDbTestFixture()
afterAll(fixture.close)
const DAY = 24 * 60 * 60 * 1000

type Row = { id: string; planReadOnly?: string; atCap?: { cap: number } }
// fetchBoardsFn registers first, fetchBoardsWithCountsFn second.
const list = async () => {
  expect(fetchBoardsWithCountsFn).toBeDefined()
  return (await hoisted.handlers[1]()) as Row[]
}

let openBoard: BoardId
let closedBoard: BoardId

async function configure(planLimits: boolean) {
  await testDb.update(settings).set({
    featureFlags: JSON.stringify({ feedback: true, planLimits }),
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

  it('labels nothing and reports no cap with the rules off', async () => {
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
