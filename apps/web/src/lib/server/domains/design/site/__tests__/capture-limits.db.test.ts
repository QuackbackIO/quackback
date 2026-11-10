/**
 * Capture limits count every call in site_capture_calls: per teammate per
 * rolling hour, per workspace per UTC day and month, and the instance's
 * monthly cap. A claimed slot counts until it is settled, and after.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, siteCaptureCalls, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { checkLimits, claimCall, monthUsage, recordCall, settleCall, usageLeft } =
  await import('../capture-limits')

const LIMITS = { userHour: 3, workspaceDay: 5, workspaceMonth: 30, instanceMonth: 90 }
const HOUR = 60 * 60 * 1000
// Wednesday 15 July 2026, 10:30 UTC.
const NOW = Date.UTC(2026, 6, 15, 10, 30)

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: siteCaptureCalls.id }).from(siteCaptureCalls).limit(0)
  },
})
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  await testDb.delete(siteCaptureCalls)
})
afterEach(async () => {
  await fixture.rollback()
})
afterAll(fixture.close)

async function teammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return principalId
}

async function calls(n: number, principalId: PrincipalId | null, at: number, billed = true) {
  for (let i = 0; i < n; i++) {
    await recordCall({ host: `site${i}.acme.test`, principalId, outcome: 'ok', billed, now: at })
  }
}

describe('capture limits', () => {
  it('allows a capture when nothing has been used', async () => {
    const p = await teammate()
    expect(await checkLimits(p, NOW, { limits: LIMITS })).toBeNull()
    expect(await usageLeft(p, NOW, { limits: LIMITS })).toEqual({
      workspaceDayLeft: 5,
      userHourLeft: 3,
      instanceMonthLeft: 30,
    })
  })

  it('stops a teammate after three in a rolling hour, until the oldest is an hour old', async () => {
    const p = await teammate()
    const other = await teammate()
    await calls(1, p, NOW - 50 * 60 * 1000)
    await calls(2, p, NOW - 10 * 60 * 1000)
    const refusal = await checkLimits(p, NOW, { limits: LIMITS })
    expect(refusal).toEqual({ limit: 'user_hour', resetsAt: new Date(NOW + 10 * 60 * 1000) })
    expect(await checkLimits(other, NOW, { limits: LIMITS })).toBeNull()
    // Eleven minutes on, the oldest call has left the hour.
    expect(await checkLimits(p, NOW + 11 * 60 * 1000, { limits: LIMITS })).toBeNull()
  })

  it('counts failed, unbilled calls too', async () => {
    const p = await teammate()
    await calls(3, p, NOW - 5 * 60 * 1000, false)
    expect((await checkLimits(p, NOW, { limits: LIMITS }))?.limit).toBe('user_hour')
  })

  it('stops the workspace after five in a UTC day, until midnight', async () => {
    await calls(5, null, NOW - 2 * HOUR)
    const p = await teammate()
    expect(await checkLimits(p, NOW, { limits: LIMITS })).toEqual({
      limit: 'workspace_day',
      resetsAt: new Date(Date.UTC(2026, 6, 16)),
    })
    // Yesterday's calls do not count against today.
    expect(await checkLimits(p, Date.UTC(2026, 6, 16, 0, 1), { limits: LIMITS })).toBeNull()
  })

  it('stops the workspace after thirty in a calendar month', async () => {
    for (let day = 1; day <= 10; day++) await calls(3, null, Date.UTC(2026, 6, day, 12))
    const refusal = await checkLimits(null, NOW, { limits: LIMITS })
    expect(refusal).toEqual({ limit: 'workspace_month', resetsAt: new Date(Date.UTC(2026, 7, 1)) })
    // Last month's calls do not count.
    expect(await checkLimits(null, Date.UTC(2026, 7, 1, 0, 1), { limits: LIMITS })).toBeNull()
  })

  it('stops at the instance cap when it is the smaller', async () => {
    await calls(2, null, Date.UTC(2026, 6, 2))
    const limits = { ...LIMITS, instanceMonth: 2 }
    expect(await checkLimits(null, NOW, { limits })).toEqual({
      limit: 'instance_month',
      resetsAt: new Date(Date.UTC(2026, 7, 1)),
    })
    expect(await monthUsage(NOW, { limits })).toEqual({ used: 2, limit: 2 })
    expect((await usageLeft(null, NOW, { limits })).instanceMonthLeft).toBe(0)
  })

  it('reports the limit that lasts longest when several are reached', async () => {
    const p = await teammate()
    await calls(3, p, NOW - 5 * 60 * 1000)
    await calls(2, null, NOW - 5 * 60 * 1000)
    expect((await checkLimits(p, NOW, { limits: LIMITS }))?.limit).toBe('workspace_day')
  })

  it('claims a slot that counts until settled, then keeps its outcome', async () => {
    const p = await teammate()
    const first = await claimCall(
      { host: 'acme.test', principalId: p, now: NOW },
      { limits: LIMITS }
    )
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('unreachable')
    expect((await usageLeft(p, NOW, { limits: LIMITS })).userHourLeft).toBe(2)
    await settleCall(first.id, { outcome: 'ok', billed: true })
    const [row] = await testDb
      .select()
      .from(siteCaptureCalls)
      .where(eq(siteCaptureCalls.id, first.id))
    expect(row).toMatchObject({ host: 'acme.test', outcome: 'ok', billed: true, principalId: p })

    await claimCall({ host: 'b.acme.test', principalId: p, now: NOW }, { limits: LIMITS })
    await claimCall({ host: 'c.acme.test', principalId: p, now: NOW }, { limits: LIMITS })
    const refused = await claimCall(
      { host: 'd.acme.test', principalId: p, now: NOW },
      { limits: LIMITS }
    )
    expect(refused).toEqual({
      ok: false,
      refusal: { limit: 'user_hour', resetsAt: new Date(NOW + HOUR) },
    })
    // A refused claim records nothing.
    expect((await monthUsage(NOW, { limits: LIMITS })).used).toBe(3)
  })
})
