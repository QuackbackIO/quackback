/**
 * WHO COUNTS AS A SEAT, against a real workspace schema.
 *
 * The control-plane index must not include portal end-users, anonymous
 * visitors or service principals. This fixture is built to discriminate:
 * dropping any clause of the predicate returns a different set.
 */
import { afterAll, afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { listTeamSeatEmails } = await import('../membership-sync-queue')

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

async function seed(
  role: 'admin' | 'member' | 'user',
  type: 'user' | 'anonymous' | 'service',
  email: string | null
) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  if (type !== 'service') {
    await testDb.insert(user).values({ id: userId, name: role, email })
  }
  await testDb.insert(principal).values({
    id: principalId,
    userId: type === 'service' ? null : userId,
    role,
    type,
    createdAt: new Date(),
  })
}

describe.skipIf(!fixture.available)('listTeamSeatEmails predicate', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('is the teammates, canonicalised, and nobody else', async () => {
    const tag = suffix()
    await seed('admin', 'user', `Admin-${tag}@Acme.Test`)
    await seed('member', 'user', `member-${tag}@acme.test`)
    await seed('user', 'user', `voter-${tag}@public.test`)
    await seed('admin', 'anonymous', `temp-${tag}@anon.invalid`)
    await seed('admin', 'user', '   ')
    await seed('admin', 'user', null)
    await seed('admin', 'service', null)

    const emails = await listTeamSeatEmails()
    expect(emails).toContain(`admin-${tag}@acme.test`)
    expect(emails).toContain(`member-${tag}@acme.test`)
    expect(emails).not.toContain(`voter-${tag}@public.test`)
    expect(emails).not.toContain(`temp-${tag}@anon.invalid`)
    expect(emails.filter((e) => e.includes(tag)).sort()).toEqual(
      [`admin-${tag}@acme.test`, `member-${tag}@acme.test`].sort()
    )
  })
})
