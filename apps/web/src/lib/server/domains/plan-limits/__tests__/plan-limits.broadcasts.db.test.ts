/**
 * Broadcasts skipped because the month's email cap is used up, against a real
 * database: each is counted once per UTC month, only with plan billing on, and
 * the count reaches the Plan limits page's used-up email row.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, settings } from '@/lib/server/db'

// The application cache, kept in memory: its kv rows are shared by every test
// file on the database, and a write that collides with another file's commit
// aborts this test's transaction.
const memoryCache = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    memoryCache.has(key) ? structuredClone(memoryCache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    memoryCache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) memoryCache.delete(key)
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { recordSkippedBroadcast, skippedBroadcastCount } from '../plan-limits.broadcasts'
import { planLimitsPage, skippedBroadcastsNote } from '../plan-limits.page'
import { planBillingOn } from './plan-billing'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

let settingsId: WorkspaceId

/** `planBilling` off is an install without plan billing. */
async function configure(options: { planBilling: boolean }) {
  await testDb
    .update(settings)
    .set({ cloud: (options.planBilling ? planBillingOn() : null) as never })
    .where(eq(settings.id, settingsId))
  await invalidateSettingsCache()
}

describe.skipIf(!fixture.available)('skipped broadcasts (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    memoryCache.clear()
    const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
    settingsId =
      row?.id ??
      (
        await testDb
          .insert(settings)
          .values({ name: 'Acme', slug: `acme-${createId('user')}`, createdAt: new Date() })
          .returning({ id: settings.id })
      )[0]!.id
  })
  afterEach(async () => {
    await fixture.rollback()
  })

  it('records each broadcast once for the month and counts it on the page row', async () => {
    await configure({ planBilling: true })
    expect(await recordSkippedBroadcast('evt-a')).toBe(true)
    expect(await recordSkippedBroadcast('evt-a')).toBe(false)
    expect(await recordSkippedBroadcast('evt-b')).toBe(true)
    expect(await skippedBroadcastCount()).toBe(2)

    const view = {
      enabled: true,
      phase: 'ok',
      plan: null,
      since: null,
      graceEndsAt: null,
      fromPlan: null,
      issues: [],
      infoRows: [
        {
          key: 'emailsPerMonth',
          used: 5,
          cap: 5,
          message: 'Emails for this month are used up',
        },
      ],
      featureIssues: [],
      features: {},
      fromFeatures: null,
      openBoardIds: null,
      keptBoardId: null,
      seatHolderIds: null,
      visibleStatusComponentIds: null,
      sendingDomainIds: null,
    } as never
    expect(planLimitsPage(view, {}, [], 2).infoRows[0].message).toBe(
      'Emails for this month are used up. 2 updates were not sent'
    )
    expect(planLimitsPage(view, {}, [], 0).infoRows[0].message).toBe(
      'Emails for this month are used up'
    )
  })

  it('counts each UTC month on its own', async () => {
    await configure({ planBilling: true })
    const lastOfNov = new Date('2026-11-30T23:59:00.000Z')
    const firstOfDec = new Date('2026-12-01T00:01:00.000Z')
    expect(await recordSkippedBroadcast('evt-nov', lastOfNov)).toBe(true)
    expect(await recordSkippedBroadcast('evt-nov', firstOfDec)).toBe(true)
    expect(await recordSkippedBroadcast('evt-dec', firstOfDec)).toBe(true)
    expect(await skippedBroadcastCount(lastOfNov)).toBe(1)
    expect(await skippedBroadcastCount(firstOfDec)).toBe(2)
    expect(skippedBroadcastsNote(1)).toBe('1 update was not sent')
    expect(skippedBroadcastsNote(3)).toBe('3 updates were not sent')
  })

  it('records nothing without plan billing', async () => {
    await configure({ planBilling: false })
    expect(await recordSkippedBroadcast('evt-off')).toBeNull()
    expect(await skippedBroadcastCount()).toBe(0)
  })
})
