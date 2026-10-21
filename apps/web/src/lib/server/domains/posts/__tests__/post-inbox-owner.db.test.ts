/**
 * Real-DB coverage for the feedback inbox's owner filter (post.inbox.ts): a
 * null owner lists the posts nobody owns, an owner id lists theirs. The
 * client sends null for the "Unassigned" option (use-inbox-query.ts).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listInboxPosts } from '../post.inbox'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, owner: posts.ownerPrincipalId }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Lea', email: `${suffix()}@team.test` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

describe.skipIf(!fixture.available)('the inbox owner filter (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lists unowned posts for a null owner, and an owner’s posts for their id', async () => {
    const lea = await seedTeammate()
    const [board] = await testDb
      .insert(boards)
      .values({ slug: `owner-${suffix()}`, name: 'Ideas', access: DEFAULT_BOARD_ACCESS })
      .returning()
    const boardId = board.id as BoardId
    const [owned] = await testDb
      .insert(posts)
      .values({ boardId, title: 'Owned', content: '', principalId: lea, ownerPrincipalId: lea })
      .returning()
    const [unowned] = await testDb
      .insert(posts)
      .values({ boardId, title: 'Unowned', content: '', principalId: lea })
      .returning()

    const none = await listInboxPosts({ boardIds: [boardId], ownerId: null, limit: 50 })
    expect(none.items.map((p) => p.id)).toEqual([unowned.id as PostId])

    const hers = await listInboxPosts({ boardIds: [boardId], ownerId: lea, limit: 50 })
    expect(hers.items.map((p) => p.id)).toEqual([owned.id as PostId])
  })
})
