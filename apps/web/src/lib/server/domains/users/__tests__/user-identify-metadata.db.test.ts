/**
 * Real-DB coverage for identifyPortalUser's metadata merge on an EXISTING user.
 * The merge subtracts removed keys from the stored jsonb; it must work with no
 * removals (re-identifying with an externalId) and with some (externalId: null).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { identifyPortalUser } from '../user.identify'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: user.id, metadata: user.metadata }).from(user).limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
  },
})

const email = () =>
  `meta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`

const metadataOf = async (userId: string) => {
  const [row] = await testDb
    .select({ metadata: user.metadata })
    .from(user)
    .where(eq(user.id, userId as never))
  return JSON.parse(row.metadata || '{}') as Record<string, unknown>
}

describe.skipIf(!fixture.available)('identifyPortalUser metadata merge (existing user)', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('re-identifying with an externalId sets it (no keys removed)', async () => {
    const e = email()
    await identifyPortalUser({ email: e, name: 'Ana' })
    const again = await identifyPortalUser({ email: e, externalId: 'ext-1' })
    expect(again.created).toBe(false)
    expect(await metadataOf(again.userId)).toMatchObject({ _externalUserId: 'ext-1' })
  })

  it('externalId: null removes it', async () => {
    const e = email()
    const first = await identifyPortalUser({ email: e, externalId: 'ext-2' })
    await identifyPortalUser({ email: e, externalId: null })
    expect(await metadataOf(first.userId)).not.toHaveProperty('_externalUserId')
  })
})
