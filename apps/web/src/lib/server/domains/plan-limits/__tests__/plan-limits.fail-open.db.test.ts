/**
 * Every runtime helper fails open: a read error never blocks a post, a
 * delivery, a seat, a status component or a sending domain. A state write
 * that fails still answers from what the read computed. The failing reads
 * reject before touching Postgres, as a lost connection does, so the test
 * transaction stays usable.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { sql } from '@/lib/server/db'

const spies = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  sourcesFail: false,
  writeFails: false,
}))

vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async (key: string) =>
    spies.cache.has(key) ? structuredClone(spies.cache.get(key)) : null,
  cacheSet: async (key: string, value: unknown) => {
    spies.cache.set(key, structuredClone(value))
  },
  cacheDel: async (...keys: string[]) => {
    for (const key of keys) spies.cache.delete(key)
  },
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/settings/settings.plan-limits', async (original) => {
  const real = await original<typeof import('@/lib/server/domains/settings/settings.plan-limits')>()
  return {
    ...real,
    readPlanLimitsSources: async () => {
      if (spies.sourcesFail) throw new Error('connection terminated')
      return real.readPlanLimitsSources()
    },
    compareAndSetPlanLimitsState: async (
      ...args: Parameters<typeof real.compareAndSetPlanLimitsState>
    ) => {
      if (spies.writeFails) throw new Error('connection terminated')
      return real.compareAndSetPlanLimitsState(...args)
    },
  }
})

import {
  getPlanLimits,
  invalidatePlanLimits,
  isBoardOpen,
  isCapEnforced,
  isFeatureLive,
  isFeaturePaused,
  isSeatPaused,
  isSendingDomainActive,
  isStatusComponentVisible,
  openBoardIds,
} from '../plan-limits.service'
import {
  DAY,
  FREE_LIKE,
  addBoard,
  addOwner,
  clearCounted,
  configure,
  ensureSettings,
  storedState,
} from './plan-limits.db-seed'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

describe.skipIf(!fixture.available)('plan limits helpers fail open (real DB)', () => {
  let settingsId: WorkspaceId
  let ownerId: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    await testDb.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2030-05-06T09:00:00.000Z') })
    spies.cache.clear()
    spies.sourcesFail = false
    spies.writeFails = false
    settingsId = await ensureSettings()
    await clearCounted(settingsId)
    ownerId = await addOwner()
  })
  afterEach(async () => {
    vi.useRealTimers()
    spies.sourcesFail = false
    spies.writeFails = false
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  it('answers every runtime helper permissively when the read fails after the deadline', async () => {
    const small = await addBoard('Acme small', 0, new Date('2026-01-01T00:00:00.000Z'), ownerId)
    await addBoard('Acme big', 2, new Date('2026-02-01T00:00:00.000Z'), ownerId)
    await configure(settingsId, { planLimits: true, tierLimits: FREE_LIKE })
    await getPlanLimits()
    vi.setSystemTime(Date.now() + 8 * DAY)
    // Enforced while reads work, so the permissive answers below come from the failure.
    expect(await isBoardOpen(small)).toBe(false)
    expect(await isCapEnforced('maxBoards')).toBe(true)

    spies.sourcesFail = true
    await expect(getPlanLimits()).rejects.toThrow('connection terminated')
    expect(await isBoardOpen(small)).toBe(true)
    expect(await openBoardIds()).toBeNull()
    expect(await isCapEnforced('maxBoards')).toBe(false)
    expect(await isFeatureLive('webhooks')).toBe(true)
    expect(await isFeaturePaused('webhooks')).toBe(false)
    expect(await isSeatPaused(createId('principal'))).toBe(false)
    expect(await isStatusComponentVisible(createId('status_component'))).toBe(true)
    expect(await isSendingDomainActive(createId('sending_domain'))).toBe(true)
  })

  it('still answers from what it computed when storing the state fails', async () => {
    await addBoard('Acme one', 0, new Date('2026-01-01T00:00:00.000Z'), ownerId)
    await addBoard('Acme two', 0, new Date('2026-02-01T00:00:00.000Z'), ownerId)
    await configure(settingsId, { planLimits: true, tierLimits: FREE_LIKE })
    spies.writeFails = true
    const limits = await getPlanLimits()
    expect(limits.phase).toBe('grace')
    expect(limits.issues.map((i) => i.key)).toEqual(['maxBoards'])
    expect(await storedState(settingsId)).toBeNull()
    // The next read that can write stores the grace.
    spies.writeFails = false
    await getPlanLimits()
    expect(await storedState(settingsId)).toMatchObject({ since: expect.any(String) })
  })
})
