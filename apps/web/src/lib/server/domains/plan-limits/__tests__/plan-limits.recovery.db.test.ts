/**
 * Recovery and partial fixes against a real database: an upgrade after the
 * deadline restores everything with nothing deleted, fixing one cap leaves
 * only the others enforced, a fix during the grace keeps the spent grace for
 * the same limits, and a later drop to other limits starts a fresh one.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, inArray, isNull, sql, statusComponents, webhooks } from '@/lib/server/db'
import type { BoardId, PrincipalId, WorkspaceId } from '@quackback/ids'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { DISABLED_CLOUD_CONFIG } from '@/lib/server/domains/settings/cloud/cloud.types'
import { planFeatureSet } from '../plan-limits.features'

const ALL_FEATURES = planFeatureSet(OSS_TIER_LIMITS.features, DISABLED_CLOUD_CONFIG)

const cache = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) => (cache.has(key) ? structuredClone(cache.get(key)) : null),
  cacheSet: async (key: string, value: unknown) => {
    cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) cache.delete(key)
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  detectPlanLimits,
  getPlanLimits,
  invalidatePlanLimits,
  isBoardOpen,
  isCapEnforced,
  isFeatureLive,
  isFeaturePaused,
  isStatusComponentVisible,
  openBoardIds,
  visibleStatusComponentIds,
} from '../plan-limits.service'
import {
  DAY,
  FREE_LIKE,
  addBoard,
  addOwner,
  addStatusComponent,
  clearCounted,
  configure,
  ensureSettings,
  storedState,
} from './plan-limits.db-seed'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

const UNLIMITED = { ...OSS_TIER_LIMITS }
const later = (days: number) => vi.setSystemTime(Date.now() + days * DAY)

describe.skipIf(!fixture.available)('plan limits recovery (real DB)', () => {
  let settingsId: WorkspaceId
  let ownerId: PrincipalId
  let small: BoardId
  let big: BoardId

  beforeEach(async () => {
    await fixture.begin()
    await testDb.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2030-03-04T09:00:00.000Z') })
    cache.clear()
    settingsId = await ensureSettings()
    await clearCounted(settingsId)
    ownerId = await addOwner()
    small = await addBoard('Acme small', 1, new Date('2026-01-01T00:00:00.000Z'), ownerId)
    big = await addBoard('Acme big', 3, new Date('2026-02-01T00:00:00.000Z'), ownerId)
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  async function addWebhook(): Promise<void> {
    await testDb.insert(webhooks).values({
      url: 'https://example.com/hook',
      secret: 'acme-secret',
      events: ['post.created'],
      createdById: ownerId,
    } as never)
    await invalidatePlanLimits()
  }

  it('restores every board and paused feature on an upgrade after the deadline, deleting nothing', async () => {
    await configure(settingsId, { planLimits: true, tierLimits: FREE_LIKE })
    await addWebhook()
    const start = await getPlanLimits()
    expect(start.phase).toBe('grace')
    later(8)
    expect((await getPlanLimits()).phase).toBe('enforced')
    expect(await isBoardOpen(small)).toBe(false)
    expect(await isFeaturePaused('webhooks')).toBe(true)
    expect(await isCapEnforced('maxBoards')).toBe(true)

    await configure(settingsId, { planLimits: true, tierLimits: UNLIMITED })
    const after = await getPlanLimits()
    expect(after.phase).toBe('ok')
    expect(after.issues).toEqual([])
    expect(await storedState(settingsId)).toBeNull()
    expect(await openBoardIds()).toBeNull()
    expect(await isBoardOpen(small)).toBe(true)
    expect(await isBoardOpen(big)).toBe(true)
    expect(await isFeatureLive('webhooks')).toBe(true)
    expect(await isFeaturePaused('webhooks')).toBe(false)
    expect(await isCapEnforced('maxBoards')).toBe(false)
    // Nothing was written to the frozen records.
    const live = await testDb
      .select({ id: boards.id })
      .from(boards)
      .where(inArray(boards.id, [small, big]))
    expect(live.map((b) => b.id).sort()).toEqual([small, big].sort())
    const hooks = await testDb.select({ status: webhooks.status }).from(webhooks)
    expect(hooks.some((h) => h.status === 'active')).toBe(true)
  })

  it('leaves only the caps still over enforced after a partial fix', async () => {
    const a = await addStatusComponent('Acme API', 0)
    const b = await addStatusComponent('Acme Web', 1)
    await configure(settingsId, {
      planLimits: true,
      tierLimits: { ...FREE_LIKE, maxStatusComponents: 1 },
    })
    await getPlanLimits()
    later(8)
    const enforced = await getPlanLimits()
    expect(enforced.issues.map((i) => i.key).sort()).toEqual(['maxBoards', 'maxStatusComponents'])
    expect(await isStatusComponentVisible(b)).toBe(false)

    // Remove the extra status component only.
    await testDb
      .update(statusComponents)
      .set({ deletedAt: new Date() })
      .where(eq(statusComponents.id, b))
    await invalidatePlanLimits()
    const partial = await getPlanLimits()
    expect(partial.phase).toBe('enforced')
    expect(partial.issues.map((i) => i.key)).toEqual(['maxBoards'])
    expect(await visibleStatusComponentIds()).toBeNull()
    expect(await isStatusComponentVisible(a)).toBe(true)
    expect(await isCapEnforced('maxStatusComponents')).toBe(false)
    // The boards are still over, so they stay frozen.
    expect(await isBoardOpen(small)).toBe(false)
    expect(await isBoardOpen(big)).toBe(true)
  })

  it('is ok after a fix during the grace, keeps that grace for the same limits, and gives a later drop a fresh one', async () => {
    await configure(settingsId, { planLimits: true, tierLimits: FREE_LIKE })
    const first = await getPlanLimits()
    expect(first.phase).toBe('grace')

    later(2)
    await testDb.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, small))
    await invalidatePlanLimits()
    expect((await getPlanLimits()).phase).toBe('ok')
    expect((await storedState(settingsId))?.since).toBe(first.since)

    // Back over the same limits: the same grace, same dates.
    later(1)
    await testDb.update(boards).set({ deletedAt: null }).where(eq(boards.id, small))
    await invalidatePlanLimits()
    const again = await getPlanLimits()
    expect(again.phase).toBe('grace')
    expect(again.since).toBe(first.since)
    expect(again.graceEndsAt).toBe(first.graceEndsAt)

    // An upgrade clears it.
    await configure(settingsId, { planLimits: true, tierLimits: UNLIMITED })
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await storedState(settingsId)).toBeNull()

    // A later drop gets a fresh grace from that moment.
    later(30)
    await configure(settingsId, { planLimits: true, tierLimits: FREE_LIKE })
    const fresh = await getPlanLimits()
    expect(fresh.phase).toBe('grace')
    expect(fresh.since).toBe(new Date().toISOString())
    expect(fresh.since).not.toBe(first.since)
  })

  it('pauses a feature only when it is set up, and only after the deadline', async () => {
    await configure(settingsId, {
      planLimits: true,
      tierLimits: { ...FREE_LIKE, maxBoards: null },
    })
    // Webhooks are off on the plan but none is set up: nothing is over.
    expect((await getPlanLimits()).phase).toBe('ok')
    // A config path still sees the plan's own answer.
    expect(await isFeatureLive('webhooks')).toBe(false)
    await addWebhook()
    // Set up on a plan that never had webhooks: it never ran, so nothing pauses.
    expect((await getPlanLimits()).phase).toBe('ok')
    // The drop from a plan that had them.
    await detectPlanLimits({ previous: { plan: 'pro', features: ALL_FEATURES } })
    expect((await getPlanLimits()).phase).toBe('grace')
    expect(await isFeaturePaused('webhooks')).toBe(false)
    later(8)
    expect(await isFeaturePaused('webhooks')).toBe(true)
    // Switching the endpoint off is the fix.
    await testDb.update(webhooks).set({ status: 'disabled' }).where(isNull(webhooks.deletedAt))
    await invalidatePlanLimits()
    expect((await getPlanLimits()).featureIssues).toEqual([])
  })
})
