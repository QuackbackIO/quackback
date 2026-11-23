/**
 * addMember and removeMember say whether they changed who is a member, which
 * the REST members route reports as its `added` and `removed` counts. Only
 * Postgres can show what the upsert's priority guard actually wrote.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type SegmentId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, principal, segments, user, userSegments } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { addMember, removeMember } from '../segment-membership.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: userSegments.segmentId }).from(userSegments).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function seed(): Promise<{ segmentId: SegmentId; principalId: PrincipalId }> {
  const segmentId = createId('segment') as SegmentId
  const slug = `m-${suffix()}`
  await testDb.insert(segments).values({ id: segmentId, name: slug, slug, type: 'manual' })
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'P', email: `${slug}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
  return { segmentId, principalId }
}

describe.skipIf(!fixture.available)('segment membership writes (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('addMember is true only when it makes someone a member', async () => {
    const { segmentId, principalId } = await seed()
    const add = (source: 'sso' | 'api' | 'manual') =>
      addMember({ principalId, segmentId, source, actor: null })

    await expect(add('sso')).resolves.toBe(true)
    // Already a member: the same source is a no-op, a stickier one only
    // upgrades the row, and a weaker one is ignored.
    await expect(add('sso')).resolves.toBe(false)
    await expect(add('api')).resolves.toBe(false)
    await expect(add('sso')).resolves.toBe(false)

    const rows = await testDb
      .select({ addedBy: userSegments.addedBy })
      .from(userSegments)
      .where(eq(userSegments.segmentId, segmentId))
    expect(rows).toEqual([{ addedBy: 'api' }])
  })

  it('removeMember is true only when there was a membership to remove', async () => {
    const { segmentId, principalId } = await seed()
    await addMember({ principalId, segmentId, source: 'api', actor: null })
    await expect(removeMember({ principalId, segmentId, actor: null })).resolves.toBe(true)
    await expect(removeMember({ principalId, segmentId, actor: null })).resolves.toBe(false)
  })
})
