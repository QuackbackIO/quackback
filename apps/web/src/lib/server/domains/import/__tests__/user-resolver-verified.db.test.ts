/**
 * Real-DB coverage for ImportUserResolver's emailVerified handling: the
 * assertion applies only to users the import CREATES (never flips an
 * existing user), lands on the inserted row, and is tallied for the
 * per-run audit summary.
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
const FALLBACK = createId('principal') as PrincipalId

async function seedExistingUser(email: string): Promise<UserId> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({ id: userId, name: 'Existing', email })
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Existing',
    createdAt: new Date(),
  })
  return userId
}

describe.skipIf(!fixture.available)('ImportUserResolver emailVerified', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('creates users honoring the per-row verified flag', async () => {
    const resolver = new ImportUserResolver()
    const verifiedEmail = `import-v-${runSuffix()}@example.com`
    const plainEmail = `import-p-${runSuffix()}@example.com`

    await resolver.resolve(verifiedEmail, 'Verified Vic', FALLBACK, true)
    await resolver.resolve(plainEmail, 'Plain Pat', FALLBACK, false)

    await resolver.flushPendingCreates()

    const [verifiedRow] = await testDb.select().from(user).where(eq(user.email, verifiedEmail))
    expect(verifiedRow.emailVerified).toBe(true)
    const [plainRow] = await testDb.select().from(user).where(eq(user.email, plainEmail))
    expect(plainRow.emailVerified).toBe(false)
  })

  it('never flips an existing user', async () => {
    const email = `import-existing-${runSuffix()}@example.com`
    const existingId = await seedExistingUser(email)

    const resolver = new ImportUserResolver()
    await resolver.resolve(email, 'Someone', FALLBACK, true)

    expect(resolver.pendingCount).toBe(0)
    await resolver.flushPendingCreates()

    const [row] = await testDb.select().from(user).where(eq(user.id, existingId))
    expect(row.emailVerified).toBe(false)
  })

  it('lets the first row for an email decide; later rows never escalate a queued create', async () => {
    const email = `import-first-${runSuffix()}@example.com`
    const resolver = new ImportUserResolver()

    await resolver.resolve(email, 'First Row', FALLBACK, false)
    await resolver.resolve(email.toUpperCase(), 'Second Row', FALLBACK, true)

    expect(resolver.pendingCount).toBe(1)
    await resolver.flushPendingCreates()

    const [row] = await testDb.select().from(user).where(eq(user.email, email))
    expect(row.emailVerified).toBe(false)
  })
})
