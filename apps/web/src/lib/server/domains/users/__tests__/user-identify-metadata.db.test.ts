/**
 * Real-DB coverage for metadata writes on an existing user: identify and
 * update merge attributes and externalId into `user.metadata` in SQL, so
 * these run the generated statement against Postgres rather than a mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, user, userAttributeDefinitions } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { identifyPortalUser, updatePortalUser } from '../user.identify'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id, metadata: user.metadata }).from(user).limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ id: userAttributeDefinitions.id }).from(userAttributeDefinitions).limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function storedMetadata(email: string): Promise<Record<string, unknown>> {
  const [row] = await testDb
    .select({ metadata: user.metadata })
    .from(user)
    .where(eq(user.email, email))
  return JSON.parse(row.metadata ?? '{}') as Record<string, unknown>
}

describe.skipIf(!fixture.available)('metadata writes on an existing user', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb.insert(userAttributeDefinitions).values([
      { key: 'plan', label: 'Plan', type: 'string' },
      { key: 'seats', label: 'Seats', type: 'number' },
    ])
  })
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('identify merges a new attribute and keeps the existing ones', async () => {
    const email = `merge-${runSuffix()}@example.com`
    await identifyPortalUser({ email, name: 'Merge M', attributes: { plan: 'pro' } })

    const result = await identifyPortalUser({ email, attributes: { seats: 5 } })

    expect(result.created).toBe(false)
    expect(result.attributes).toEqual({ plan: 'pro', seats: 5 })
    expect(await storedMetadata(email)).toEqual({ plan: 'pro', seats: 5 })
  })

  it('identify removes an attribute sent as null and keeps the rest', async () => {
    const email = `remove-${runSuffix()}@example.com`
    await identifyPortalUser({ email, name: 'Remove R', attributes: { plan: 'pro', seats: 5 } })

    const result = await identifyPortalUser({ email, attributes: { plan: null } })

    expect(result.created).toBe(false)
    expect(result.attributes).toEqual({ seats: 5 })
    expect(await storedMetadata(email)).toEqual({ seats: 5 })
  })

  it('identify sets and then clears externalId on an existing user', async () => {
    const email = `ext-${runSuffix()}@example.com`
    await identifyPortalUser({ email, name: 'Ext E', attributes: { plan: 'pro' } })

    const set = await identifyPortalUser({ email, externalId: 'ext-123' })
    expect(set.externalId).toBe('ext-123')
    expect(set.attributes).toEqual({ plan: 'pro' })

    const cleared = await identifyPortalUser({ email, externalId: null })
    expect(cleared.externalId).toBeNull()
    expect(await storedMetadata(email)).toEqual({ plan: 'pro' })
  })

  it('update merges attributes, removes nulls and sets externalId on an existing user', async () => {
    const email = `update-${runSuffix()}@example.com`
    const created = await identifyPortalUser({
      email,
      name: 'Update U',
      attributes: { plan: 'pro', seats: 5 },
    })

    const updated = await updatePortalUser(created.principalId, {
      attributes: { plan: 'enterprise', seats: null },
      externalId: 'ext-456',
    })

    expect(updated.attributes).toEqual({ plan: 'enterprise' })
    expect(updated.externalId).toBe('ext-456')
  })
})
