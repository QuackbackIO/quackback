/**
 * Real-DB coverage for identifyPortalUser's metadata merge on an EXISTING
 * user: a set with nothing to remove, then a removal. Both used to render the
 * removed keys as a parenthesised list cast to text[], which Postgres rejects,
 * so every repeat identify that touched metadata failed.
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
import { EXTERNAL_ID_KEY } from '../user.attributes'

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
  return JSON.parse(row?.metadata || '{}')
}

describe.skipIf(!fixture.available)('identifyPortalUser metadata merge', () => {
  beforeEach(() => fixture.begin())
  afterEach(() => fixture.rollback())
  afterAll(() => fixture.close())

  it('sets and then removes a metadata key on an existing user', async () => {
    const email = `metadata-${runSuffix()}@example.com`
    await identifyPortalUser({ email, name: 'Meta M' })

    await identifyPortalUser({ email, externalId: 'ext-1' })
    expect(await storedMetadata(email)).toMatchObject({ [EXTERNAL_ID_KEY]: 'ext-1' })

    await identifyPortalUser({ email, externalId: null })
    expect(await storedMetadata(email)).not.toHaveProperty(EXTERNAL_ID_KEY)
  })
})
