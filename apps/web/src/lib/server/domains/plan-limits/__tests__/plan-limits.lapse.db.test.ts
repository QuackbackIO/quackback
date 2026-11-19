/**
 * Detection when a plan term lapses on the clock, with no projection write:
 * the grace starts at the expiry instant and carries the lapsed plan, read
 * back from the stored projection. Also the projection-write merge never
 * replaces a plan a grace already names.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, settings, sql } from '@/lib/server/db'

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
  detectPlanLimitsAfterProjectionWrite,
  getPlanLimits,
  invalidatePlanLimits,
  isFeatureLive,
} from '../plan-limits.service'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import {
  addBoard,
  addOwner,
  clearCounted,
  configure,
  ensureSettings,
  projection,
  storedState,
} from './plan-limits.db-seed'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

const EXPIRY = '2030-06-10T15:00:00.000Z'
// Every paid feature, so nothing another suite left set up puts Pro over.
const PRO = {
  customDomain: true,
  sso: true,
  webhooks: true,
  workflows: true,
  aiAssistant: true,
  aiArticleTranslation: true,
}

describe.skipIf(!fixture.available)('plan limits on a lapsing term (real DB)', () => {
  let settingsId: WorkspaceId
  let ownerId: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    await testDb.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2030-06-01T09:00:00.000Z') })
    cache.clear()
    settingsId = await ensureSettings()
    await clearCounted(settingsId)
    ownerId = await addOwner()
    await addBoard('Acme one', 0, new Date('2026-01-01T00:00:00.000Z'), ownerId)
    await addBoard('Acme two', 0, new Date('2026-02-01T00:00:00.000Z'), ownerId)
    // Pro until the expiry, then the Free limits (one board).
    await configure(settingsId, {
      planLimits: true,
      tierLimits: null,
      cloud: {
        enabled: true,
        projection: projection(1, 'pro', null, PRO, EXPIRY),
      },
    })
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('is ok up to the expiry and starts the grace at it, carrying the lapsed plan', async () => {
    vi.setSystemTime(Date.parse(EXPIRY) - 1)
    expect((await getPlanLimits()).phase).toBe('ok')
    expect(await storedState(settingsId)).toBeNull()

    vi.setSystemTime(Date.parse(EXPIRY))
    await invalidatePlanLimits()
    const lapsed = await getPlanLimits()
    expect(lapsed.phase).toBe('grace')
    expect(lapsed.plan).toBe('free')
    expect(lapsed.since).toBe(EXPIRY)
    expect(lapsed.fromPlan).toBe('pro')
    expect(lapsed.fromFeatures?.webhooks).toBe(true)
    // Not set up, so not a feature issue; but live through the grace.
    expect(await isFeatureLive('webhooks')).toBe(true)
    expect(await storedState(settingsId)).toMatchObject({ since: EXPIRY, fromPlan: 'pro' })
  })

  it('never replaces the plan a grace already names when a projection write merges', async () => {
    vi.setSystemTime(Date.parse(EXPIRY) + 1000)
    const appliedAt = new Date(Date.parse(EXPIRY))
    await getPlanLimits()
    const stored = await storedState(settingsId)
    expect(stored?.fromPlan).toBe('pro')
    // As if the grace named another plan.
    await testDb
      .update(settings)
      .set({ planLimitsState: { ...stored, fromPlan: 'business' } as never })
      .where(eq(settings.id, settingsId))
    await invalidateSettingsCache()
    await detectPlanLimitsAfterProjectionWrite(projection(1, 'pro', null, PRO), appliedAt)
    expect((await storedState(settingsId))?.fromPlan).toBe('business')
  })
})
