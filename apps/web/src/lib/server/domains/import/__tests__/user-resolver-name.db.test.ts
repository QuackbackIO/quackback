/**
 * Real-DB coverage for ImportUserResolver name-only authors: a CSV
 * author_name with no email creates (or reuses) a name-only portal
 * person, never the importer, and never an identified user who happens
 * to share the display name.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, and, isNull, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { ImportUserResolver } from '../user-resolver'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: user.id, email: user.email, verified: user.emailVerified })
      .from(user)
      .limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedIdentifiedUser(name: string, email: string): Promise<UserId> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name, email })
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return userId
}

async function seedNameOnlyPerson(name: string, createdAt = new Date()): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email: null })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: name,
    createdAt,
  })
  return principalId
}

describe.skipIf(!fixture.available)('ImportUserResolver name-only authors', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('creates a name-only portal person when email is empty', async () => {
    const resolver = new ImportUserResolver()
    const name = `Jane ${runSuffix()}`

    const principalId = await resolver.resolve(null, name)
    expect(resolver.pendingCount).toBe(1)

    await resolver.flushPendingCreates()

    const [userRow] = await testDb.select().from(user).where(eq(user.name, name))
    expect(userRow.email).toBeNull()
    expect(userRow.emailVerified).toBe(false)

    const [principalRow] = await testDb
      .select()
      .from(principal)
      .where(eq(principal.userId, userRow.id))
    expect(principalRow.id).toBe(principalId)
    expect(principalRow.displayName).toBe(name)
    expect(principalRow.role).toBe('user')
    expect(principalRow.type).toBe('user')
  })

  it('reuses the same pending create for the same name with different casing or whitespace', async () => {
    const resolver = new ImportUserResolver()
    const suffix = runSuffix()

    const first = await resolver.resolve('', `  Jane ${suffix}  `)
    const second = await resolver.resolve(null, `jane ${suffix}`)

    expect(first).toBe(second)
    expect(resolver.pendingCount).toBe(1)

    await resolver.flushPendingCreates()

    const rows = await testDb
      .select()
      .from(user)
      .where(and(isNull(user.email), eq(user.name, `Jane ${suffix}`)))
    expect(rows).toHaveLength(1)
  })

  it('reuses an existing name-only person with that display name', async () => {
    const name = `Pat ${runSuffix()}`
    const existing = await seedNameOnlyPerson(name)

    const resolver = new ImportUserResolver()
    const resolved = await resolver.resolve(null, name.toUpperCase())

    expect(resolved).toBe(existing)
    expect(resolver.pendingCount).toBe(0)
    await resolver.flushPendingCreates()

    const rows = await testDb.select().from(user).where(eq(user.name, name))
    expect(rows).toHaveLength(1)
  })

  it('does not reuse an identified user who shares the display name', async () => {
    const name = `Sam ${runSuffix()}`
    await seedIdentifiedUser(name, `sam-${runSuffix()}@example.com`)

    const resolver = new ImportUserResolver()
    const resolved = await resolver.resolve(null, name)

    expect(resolver.pendingCount).toBe(1)
    await resolver.flushPendingCreates()

    const [principalRow] = await testDb.select().from(principal).where(eq(principal.id, resolved))
    expect(principalRow.displayName).toBe(name)

    const nameOnly = await testDb
      .select()
      .from(user)
      .where(and(isNull(user.email), eq(user.name, name)))
    expect(nameOnly).toHaveLength(1)
  })

  it('throws and queues nothing when email and name are both empty', async () => {
    const resolver = new ImportUserResolver()

    await expect(resolver.resolve(null, null)).rejects.toThrow(/name or email/)
    await expect(resolver.resolve('', '   ')).rejects.toThrow(/name or email/)
    expect(resolver.pendingCount).toBe(0)
  })
})
