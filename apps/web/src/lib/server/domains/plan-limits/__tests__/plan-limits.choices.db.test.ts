/**
 * The status component and sending domain choosers against a real database:
 * a choice is validated, stored, honoured after the deadline, and survives a
 * later read. Also the defaults when nobody chooses.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type WorkspaceId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { sql } from '@/lib/server/db'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

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
  activeSendingDomainIds,
  getPlanLimits,
  invalidatePlanLimits,
  isSendingDomainActive,
  isStatusComponentVisible,
  visibleStatusComponentIds,
} from '../plan-limits.service'
import { setKeptSendingDomains, setVisibleStatusComponents } from '../plan-limits.choosers'
import {
  DAY,
  addSendingDomain,
  addStatusComponent,
  clearCounted,
  configure,
  ensureSettings,
  storedState,
} from './plan-limits.db-seed'

const fixture = await createDbTestFixture()
afterAll(fixture.close)

const afterDeadline = () => vi.setSystemTime(Date.now() + 8 * DAY)

describe.skipIf(!fixture.available)('plan limits choosers (real DB)', () => {
  let settingsId: WorkspaceId

  beforeEach(async () => {
    await fixture.begin()
    await testDb.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2030-04-01T09:00:00.000Z') })
    cache.clear()
    settingsId = await ensureSettings()
    await clearCounted(settingsId)
  })
  afterEach(async () => {
    vi.useRealTimers()
    await invalidatePlanLimits()
    await fixture.rollback()
  })

  describe('status components', () => {
    let first: string
    let second: string
    let third: string
    beforeEach(async () => {
      first = await addStatusComponent('Acme API', 0)
      second = await addStatusComponent('Acme Web', 1)
      third = await addStatusComponent('Acme Mail', 2)
      await configure(settingsId, {
        planBilling: true,
        tierLimits: { ...OSS_TIER_LIMITS, maxStatusComponents: 2 },
      })
    })

    it('shows the first ones in display order by default, and all of them during the grace', async () => {
      expect((await getPlanLimits()).phase).toBe('grace')
      expect(await visibleStatusComponentIds()).toBeNull()
      expect(await isStatusComponentVisible(third)).toBe(true)
      afterDeadline()
      expect(await visibleStatusComponentIds()).toEqual([first, second])
      expect(await isStatusComponentVisible(third)).toBe(false)
    })

    it('stores and honours the chosen components after the deadline', async () => {
      expect(await setVisibleStatusComponents([third, first])).toEqual({ ok: true })
      expect((await storedState(settingsId))?.visibleStatusComponentIds).toEqual([third, first])
      afterDeadline()
      expect(await isStatusComponentVisible(third)).toBe(true)
      expect(await isStatusComponentVisible(first)).toBe(true)
      expect(await isStatusComponentVisible(second)).toBe(false)
      // A later read keeps the choice.
      await invalidatePlanLimits()
      expect((await getPlanLimits()).visibleStatusComponentIds).toEqual([third, first])
    })

    it('refuses more than the cap, an unknown component, and a cap that is not over', async () => {
      expect(await setVisibleStatusComponents([first, second, third])).toEqual({
        ok: false,
        reason: 'too_many',
      })
      expect(await setVisibleStatusComponents([createId('status_component')])).toEqual({
        ok: false,
        reason: 'unknown',
      })
      expect(await setKeptSendingDomains([])).toEqual({ ok: false, reason: 'not_over' })
      expect((await storedState(settingsId))?.visibleStatusComponentIds).toBeUndefined()
    })
  })

  describe('sending domains', () => {
    let older: string
    let pending: string
    let newer: string
    beforeEach(async () => {
      pending = await addSendingDomain('a.example.com', 'pending', new Date('2026-01-01'))
      older = await addSendingDomain('b.example.com', 'verified', new Date('2026-02-01'))
      newer = await addSendingDomain('c.example.com', 'verified', new Date('2026-03-01'))
      await configure(settingsId, {
        planBilling: true,
        tierLimits: { ...OSS_TIER_LIMITS, maxSendingDomains: 1 },
      })
    })

    it('keeps the oldest verified domain by default, after the deadline only', async () => {
      expect((await getPlanLimits()).issues.map((i) => i.key)).toEqual(['maxSendingDomains'])
      expect(await isSendingDomainActive(newer)).toBe(true)
      afterDeadline()
      expect(await activeSendingDomainIds()).toEqual([older])
      expect(await isSendingDomainActive(pending)).toBe(false)
      expect(await isSendingDomainActive(newer)).toBe(false)
    })

    it('stores and honours the chosen domain', async () => {
      expect(await setKeptSendingDomains([newer])).toEqual({ ok: true })
      afterDeadline()
      expect(await isSendingDomainActive(newer)).toBe(true)
      expect(await isSendingDomainActive(older)).toBe(false)
    })

    it('refuses more domains than the cap', async () => {
      expect(await setKeptSendingDomains([older, newer])).toEqual({ ok: false, reason: 'too_many' })
    })
  })
})
