import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from './db-test-fixture'
import { changelogEntries, conversations, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('./db-test-fixture')).testDb,
}))

import { customerInteractions, fifthActiveDay } from '../github-star-prompt'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id }).from(principal).limit(0)
  },
})

async function teammate() {
  const userId = createId('user')
  const principalId = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Sam', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', createdAt: new Date() })
  return principalId
}

describe('the star prompt activity checks', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('finds the fifth separate day this person did something, not the fifth action', async () => {
    const principalId = await teammate()
    expect(await fifthActiveDay(principalId)).toBeNull()

    const day = (n: number, hour = 10) => new Date(Date.UTC(2026, 9, n, hour))
    // Two entries on the first day count once.
    const dates = [day(1), day(1, 15), day(3), day(4), day(8)]
    await testDb
      .insert(changelogEntries)
      .values(dates.map((createdAt) => ({ title: 'Update', content: 'x', principalId, createdAt })))
    expect(await fifthActiveDay(principalId)).toBeNull()

    await testDb
      .insert(changelogEntries)
      .values({ title: 'Update', content: 'x', principalId, createdAt: day(12) })
    expect((await fifthActiveDay(principalId))?.toISOString()).toBe(
      new Date(Date.UTC(2026, 9, 12)).toISOString()
    )
  })

  it('counts customer conversations but not a teammate test visitor, up to the threshold', async () => {
    const owner = await teammate()
    const before = await customerInteractions()
    const customer = createId('principal')
    const testVisitor = createId('principal')
    await testDb.insert(principal).values([
      { id: customer, role: 'user', type: 'anonymous', createdAt: new Date() },
      {
        id: testVisitor,
        role: 'user',
        type: 'anonymous',
        createdAt: new Date(),
        testOwnerPrincipalId: owner,
      },
    ])
    await testDb.insert(conversations).values([
      { visitorPrincipalId: customer, channel: 'messenger' as const },
      { visitorPrincipalId: testVisitor, channel: 'messenger' as const },
    ])
    expect(await customerInteractions()).toBe(Math.min(before + 1, 60))

    await testDb.insert(conversations).values(
      Array.from({ length: 25 }, () => ({
        visitorPrincipalId: customer,
        channel: 'messenger' as const,
      }))
    )
    // Each source stops counting at the threshold.
    expect(await customerInteractions()).toBeLessThanOrEqual(60)
    expect(await customerInteractions()).toBeGreaterThanOrEqual(20)
  })
})
