/**
 * RMP-E-03: updatePost stores every ETA as the first of its UTC month, so the
 * roadmap's month buckets hold whichever caller sets it. null clears it.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, eq, posts, principal, user } from '@/lib/server/db'
import { updatePost } from '../post.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, eta: posts.eta }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedPost(): Promise<{ postId: PostId; actor: { principalId: PrincipalId } }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'ETA author' })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName: 'ETA author',
    createdAt: new Date(),
  })
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `eta-${suffix()}`, name: 'ETA board' })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({ boardId: board.id, title: 'ETA post', content: '', principalId })
    .returning()
  return { postId: post.id, actor: { principalId } }
}

async function storedEta(postId: PostId): Promise<string | null> {
  const [row] = await testDb.select({ eta: posts.eta }).from(posts).where(eq(posts.id, postId))
  return row.eta ? row.eta.toISOString() : null
}

describe.skipIf(!fixture.available)('post ETA truncation (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it.each([
    ['a mid-month instant', '2027-03-17T13:00:00.000Z', '2027-03-01T00:00:00.000Z'],
    ['the last millisecond of a month', '2027-03-31T23:59:59.999Z', '2027-03-01T00:00:00.000Z'],
    [
      'an offset that is already next month in UTC',
      '2027-03-31T20:00:00-05:00',
      '2027-04-01T00:00:00.000Z',
    ],
    [
      'an offset that is still last month in UTC',
      '2027-04-01T03:00:00+05:00',
      '2027-03-01T00:00:00.000Z',
    ],
    ['the first of the month', '2027-12-01T00:00:00.000Z', '2027-12-01T00:00:00.000Z'],
  ])('RMP-E-03 stores %s as the first of its UTC month', async (_label, sent, expected) => {
    const { postId, actor } = await seedPost()

    const updated = await updatePost(postId, { eta: new Date(sent) }, actor)

    expect(updated.eta?.toISOString()).toBe(expected)
    expect(await storedEta(postId)).toBe(expected)
  })

  it('RMP-E-03 null clears the ETA and undefined leaves it', async () => {
    const { postId, actor } = await seedPost()
    await updatePost(postId, { eta: new Date('2027-06-20T00:00:00.000Z') }, actor)

    await updatePost(postId, { pinned: true }, actor)
    expect(await storedEta(postId)).toBe('2027-06-01T00:00:00.000Z')

    await updatePost(postId, { eta: null }, actor)
    expect(await storedEta(postId)).toBeNull()
  })
})
