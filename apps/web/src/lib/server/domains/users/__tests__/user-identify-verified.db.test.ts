/**
 * Real-DB coverage for identifyPortalUser's `emailVerifiedAsserted` flag —
 * the signal the REST identify route audits on. Asserted only when THIS call
 * vouches for the email: created verified, or an existing user flipped
 * false -> true. Re-asserting an already-verified user is a no-op.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, user, userAttributeDefinitions } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { identifyPortalUser } from '../user.identify'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: user.id, email: user.email, verified: user.emailVerified })
      .from(user)
      .limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ id: userAttributeDefinitions.id }).from(userAttributeDefinitions).limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

describe.skipIf(!fixture.available)('identifyPortalUser emailVerifiedAsserted', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('is true when a user is created with emailVerified=true', async () => {
    const email = `created-verified-${runSuffix()}@example.com`
    const result = await identifyPortalUser({ email, name: 'Created V', emailVerified: true })

    expect(result.created).toBe(true)
    expect(result.emailVerified).toBe(true)
    expect(result.emailVerifiedAsserted).toBe(true)
  })

  it('is false when a user is created without emailVerified', async () => {
    const email = `created-plain-${runSuffix()}@example.com`
    const result = await identifyPortalUser({ email, name: 'Created P' })

    expect(result.created).toBe(true)
    expect(result.emailVerified).toBe(false)
    expect(result.emailVerifiedAsserted).toBe(false)
  })

  it('is true when an existing unverified user is flipped false -> true', async () => {
    const email = `flip-${runSuffix()}@example.com`
    await identifyPortalUser({ email, name: 'Flip F' })

    const result = await identifyPortalUser({ email, emailVerified: true })

    expect(result.created).toBe(false)
    expect(result.emailVerified).toBe(true)
    expect(result.emailVerifiedAsserted).toBe(true)

    const [row] = await testDb.select().from(user).where(eq(user.id, result.userId as never))
    expect(row.emailVerified).toBe(true)
  })

  it('is false when the user is already verified (true -> true no-op)', async () => {
    const email = `noop-${runSuffix()}@example.com`
    await identifyPortalUser({ email, name: 'Noop N', emailVerified: true })

    const result = await identifyPortalUser({ email, emailVerified: true })

    expect(result.emailVerified).toBe(true)
    expect(result.emailVerifiedAsserted).toBe(false)
  })

  it('is false when emailVerified is explicitly false (including true -> false revoke)', async () => {
    const email = `revoke-${runSuffix()}@example.com`
    await identifyPortalUser({ email, name: 'Revoke R', emailVerified: true })

    const result = await identifyPortalUser({ email, emailVerified: false })

    expect(result.emailVerified).toBe(false)
    expect(result.emailVerifiedAsserted).toBe(false)
  })
})
