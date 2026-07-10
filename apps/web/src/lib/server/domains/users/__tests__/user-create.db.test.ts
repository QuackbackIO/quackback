/**
 * Real-DB coverage for createPortalUser (ad-hoc contact creation).
 *
 * Proves the emailVerified assertion end to end: the flag lands on the user
 * row AND the `user.email_verified.asserted` audit row is written with the
 * asserting actor — recordAuditEvent inserts through the same rebound `db`,
 * so the row is visible inside (and rolled back with) the fixture
 * transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { auditLog, eq, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { createPortalUser } from '../user.create'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: user.id, email: user.email, verified: user.emailVerified })
      .from(user)
      .limit(0)
    await db.select({ id: principal.id, type: principal.type }).from(principal).limit(0)
    await db
      .select({ id: auditLog.id, event: auditLog.eventType, actor: auditLog.actorUserId })
      .from(auditLog)
      .limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * audit_log.actor_user_id carries an FK to user, so the asserting admin must
 * be a real row. Seeded per-test inside the fixture transaction.
 */
async function seedAdminActor() {
  const userId = createId('user') as UserId
  const email = `admin-${runSuffix()}@example.com`
  await testDb.insert(user).values({ id: userId, name: 'Audit Admin', email })
  return { userId, email, role: 'admin', type: 'user' as const }
}

async function auditRowsFor(userId: string) {
  return testDb
    .select()
    .from(auditLog)
    .where(eq(auditLog.eventType, 'user.email_verified.asserted'))
    .then((rows) => rows.filter((r) => r.targetId === userId))
}

describe.skipIf(!fixture.available)('createPortalUser', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('defaults emailVerified to true (claimable shell) and audits the assertion', async () => {
    const email = `default-${runSuffix()}@example.com`
    const result = await createPortalUser({ name: 'Default Dana', email })

    expect(result.emailVerified).toBe(true)

    const [row] = await testDb.select().from(user).where(eq(user.id, result.userId))
    expect(row.emailVerified).toBe(true)
    expect(row.email).toBe(email)

    const [p] = await testDb.select().from(principal).where(eq(principal.id, result.principalId))
    expect(p).toMatchObject({ role: 'user', type: 'user', userId: result.userId })

    expect(await auditRowsFor(result.userId)).toHaveLength(1)
  })

  it('honors an explicit emailVerified=false opt-out and writes no audit event', async () => {
    const email = `optout-${runSuffix()}@example.com`
    const result = await createPortalUser({ name: 'Unverified Uma', email, emailVerified: false })

    expect(result.emailVerified).toBe(false)
    const [row] = await testDb.select().from(user).where(eq(user.id, result.userId))
    expect(row.emailVerified).toBe(false)
    expect(await auditRowsFor(result.userId)).toHaveLength(0)
  })

  it('persists an asserted emailVerified and audits who asserted it', async () => {
    const actor = await seedAdminActor()
    const email = `Asserted-${runSuffix()}@Example.com`
    const result = await createPortalUser(
      { name: 'Vera Vouched', email, emailVerified: true },
      { actor }
    )

    expect(result.emailVerified).toBe(true)
    expect(result.email).toBe(email.toLowerCase())

    const [row] = await testDb.select().from(user).where(eq(user.id, result.userId))
    expect(row.emailVerified).toBe(true)

    const audits = await auditRowsFor(result.userId)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      eventType: 'user.email_verified.asserted',
      eventOutcome: 'success',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      actorRole: 'admin',
      targetType: 'user',
      targetId: result.userId,
    })
    expect(audits[0].afterValue).toEqual({ emailVerified: true })
    expect(audits[0].metadata).toMatchObject({
      source: 'admin.create_portal_user',
      email: email.toLowerCase(),
    })
  })

  it('ignores emailVerified when no email is provided', async () => {
    const actor = await seedAdminActor()
    const result = await createPortalUser({ name: 'No Email Ned', emailVerified: true }, { actor })

    expect(result.email).toBeNull()
    expect(result.emailVerified).toBe(false)
    expect(await auditRowsFor(result.userId)).toHaveLength(0)
  })

  it('rejects a duplicate email', async () => {
    const email = `dupe-${runSuffix()}@example.com`
    await createPortalUser({ name: 'First', email })

    await expect(createPortalUser({ name: 'Second', email: email.toUpperCase() })).rejects.toThrow(
      'already exists'
    )
  })
})
