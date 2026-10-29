/**
 * Real-DB coverage for the inbox's Team response facet counts.
 *
 * The counts select a correlated EXISTS over post_comments. Drizzle renders
 * columns in a single-table select list without their table prefix, so an
 * outer `posts.id` written as a Drizzle column binds to `post_comments.id`
 * inside the subquery and every post counts as unresponded. Only real SQL
 * shows that, so this suite runs against Postgres.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postComments, posts, principal, user } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { countInboxFilterFacets, listInboxPosts } from '../post.inbox'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, canonicalPostId: posts.canonicalPostId }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(name: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'admin',
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return principalId
}

async function seedBoard(): Promise<BoardId> {
  const [board] = await testDb
    .insert(boards)
    .values({
      slug: `responded-${suffix()}`,
      name: 'Responded board',
      access: DEFAULT_BOARD_ACCESS,
    })
    .returning()
  return board.id
}

async function seedPost(boardId: BoardId, author: PrincipalId, title: string): Promise<PostId> {
  const [post] = await testDb
    .insert(posts)
    .values({ boardId, title, content: '', principalId: author })
    .returning()
  return post.id
}

async function seedComment(postId: PostId, author: PrincipalId, isTeamMember: boolean) {
  await testDb
    .insert(postComments)
    .values({ postId, principalId: author, content: 'comment', isTeamMember })
}

describe.skipIf(!fixture.available)('inbox Team response facet counts (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts posts with a team comment as responded, matching the filtered list', async () => {
    const author = await seedPrincipal('Author')
    const boardId = await seedBoard()
    const answered = await seedPost(boardId, author, 'Answered')
    const userOnly = await seedPost(boardId, author, 'User comment only')
    await seedPost(boardId, author, 'Silent')
    await seedComment(answered, author, true)
    await seedComment(userOnly, author, false)

    const counts = await countInboxFilterFacets({ boardIds: [boardId], responded: 'responded' })
    expect(counts.responded).toEqual({ responded: 1, unresponded: 2 })

    const list = await listInboxPosts({ boardIds: [boardId], responded: 'responded' })
    expect(list.items.map((p) => p.title)).toEqual(['Answered'])
  })
})
