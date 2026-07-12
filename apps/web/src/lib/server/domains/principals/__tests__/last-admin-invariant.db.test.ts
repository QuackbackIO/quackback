/**
 * Real-Postgres regression coverage for the last-admin guard in
 * setPrincipalRole (principal.factory.ts). The mocked sibling suite
 * (last-admin-invariant.test.ts) exercises the guard's branching logic but
 * never round-trips its exclusion predicate through a real uuid column, so it
 * cannot catch a driver-level mismatch. This suite does: it demotes a seeded
 * admin against the live schema, which runs the `ne(principal.id, ...)` /
 * `ne(principal.userId, ...)` exclusion count for real.
 *
 * This is the exact path that regressed once: comparing the branded TypeID ref
 * against the uuid-storage column with a raw `sql` fragment (bypassing the
 * column's TypeID-to-uuid mapping) made Postgres reject every demotion with
 * "invalid input syntax for type uuid", breaking the whole remove/demote
 * teammate flow. Keeping a real-DB assertion here stops that from returning.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))

import { setPrincipalRole } from '../principal.factory'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id, email: user.email }).from(user).limit(0)
    await db
      .select({ id: principal.id, role: principal.role, type: principal.type })
      .from(principal)
      .limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Seed a real human admin (user + type='user' admin principal). */
async function seedAdmin() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: 'Admin', email: `admin-${suffix()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    createdAt: new Date(),
  })
  return { userId, principalId }
}

describe.skipIf(!fixture.available)('setPrincipalRole — last-admin guard (real Postgres)', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('demotes an admin by principalId without a uuid coercion error when another admin remains', async () => {
    // Two admins so the exclusion count sees a remaining admin; the value here
    // is that the count query executes against the real column at all.
    const a = await seedAdmin()
    await seedAdmin()

    await expect(setPrincipalRole({ principalId: a.principalId }, 'member')).resolves.toBeDefined()

    const [row] = await testDb.select().from(principal).where(eq(principal.id, a.principalId))
    expect(row.role).toBe('member')
  })

  it('demotes an admin by userId without a uuid coercion error when another admin remains', async () => {
    const a = await seedAdmin()
    await seedAdmin()

    await expect(setPrincipalRole({ userId: a.userId }, 'member')).resolves.toBeDefined()

    const [row] = await testDb.select().from(principal).where(eq(principal.id, a.principalId))
    expect(row.role).toBe('member')
  })
})
