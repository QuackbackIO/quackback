/**
 * Real-DB coverage for listPortalUsers paging by row offset.
 *
 * The REST users cursor carries a row offset. Paging by page number instead
 * repeats or skips rows as soon as a caller changes the limit between pages.
 * Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPortalUsers } from '../user.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ id: user.id }).from(user).limit(0)
  },
})

const marker = `offset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedUser(n: number): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const name = `${marker} ${n}`
  await testDb.insert(user).values({ id: userId, name, email: `${marker}-${n}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

describe.skipIf(!fixture.available)('listPortalUsers offset paging (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('starts at the given row offset whatever the limit', async () => {
    const seeded: PrincipalId[] = []
    for (const n of [1, 2, 3, 4, 5, 6]) seeded.push(await seedUser(n))

    const page = await listPortalUsers({ search: marker, sort: 'name', offset: 2, limit: 3 })

    expect(page.items.map((u) => u.principalId)).toEqual(seeded.slice(2, 5))
    expect(page.total).toBe(6)
    expect(page.hasMore).toBe(true)

    const last = await listPortalUsers({ search: marker, sort: 'name', offset: 5, limit: 3 })
    expect(last.items.map((u) => u.principalId)).toEqual(seeded.slice(5))
    expect(last.hasMore).toBe(false)
  })
})
