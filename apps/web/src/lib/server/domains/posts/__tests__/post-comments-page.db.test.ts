/**
 * Real-DB coverage for the admin post detail's comment page.
 *
 * The page holds the thread's newest root comments (the post's own and those of
 * posts merged into it) with their replies, newest roots first. Its only
 * caller loads the post and its board alongside it, so the page reads only
 * comments: re-checking that the post and board exist cost two statements
 * and two round trips, one after the other, before any comment was read.
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

import { getPaginatedCommentsWithReplies } from '../post.query'

const statements: string[] = []
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, canonicalPostId: posts.canonicalPostId }).from(posts).limit(0)
  },
  logger: { logQuery: (query) => statements.push(query) },
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
    .values({ slug: `comments-${suffix()}`, name: 'Comments board', access: DEFAULT_BOARD_ACCESS })
    .returning()
  return board.id
}

async function seedPost(boardId: BoardId, author: PrincipalId, canonicalPostId?: PostId) {
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId,
      title: canonicalPostId ? 'Source' : 'Canonical',
      content: '',
      principalId: author,
      ...(canonicalPostId && { canonicalPostId, mergedAt: new Date() }),
    })
    .returning()
  return post.id
}

async function seedComment(
  postId: PostId,
  author: PrincipalId,
  content: string,
  createdAt: Date,
  parentId?: string
) {
  const [comment] = await testDb
    .insert(postComments)
    .values({
      postId,
      principalId: author,
      content,
      isTeamMember: false,
      createdAt,
      ...(parentId && { parentId: parentId as never }),
    })
    .returning()
  return comment.id
}

describe.skipIf(!fixture.available)('admin post detail comment page (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it("pages the thread's roots, merged posts' included, with their replies", async () => {
    const author = await seedPrincipal('Author')
    const boardId = await seedBoard()
    const canonical = await seedPost(boardId, author)
    const source = await seedPost(boardId, author, canonical)
    const first = await seedComment(canonical, author, 'first', new Date('2026-01-01T00:00:00Z'))
    await seedComment(source, author, 'on the source', new Date('2026-01-02T00:00:00Z'))
    await seedComment(canonical, author, 'newest', new Date('2026-01-03T00:00:00Z'))
    await seedComment(canonical, author, 'reply', new Date('2026-01-04T00:00:00Z'), first)

    const page = await getPaginatedCommentsWithReplies(canonical, { limit: 2 })

    expect(page.totalRootCount).toBe(3)
    expect(page.hasMore).toBe(true)
    // The newest roots, shown oldest first within the page.
    expect(page.comments.map((c) => c.content)).toEqual(['on the source', 'newest'])

    const rest = await getPaginatedCommentsWithReplies(canonical, {
      limit: 2,
      cursor: page.nextCursor,
    })
    expect(rest.comments.map((c) => c.content)).toEqual(['first'])
    expect(rest.comments[0]?.replies.map((r) => r.content)).toEqual(['reply'])
  })

  it('reads comments only, not the post and board its caller already loads', async () => {
    const author = await seedPrincipal('Author')
    const boardId = await seedBoard()
    const postId = await seedPost(boardId, author)
    await seedComment(postId, author, 'hello', new Date('2026-01-01T00:00:00Z'))

    statements.length = 0
    await getPaginatedCommentsWithReplies(postId, { limit: 10 })

    const probes = statements.filter((q) =>
      /from "(posts|boards)" "\w+" where "\w+"\."id" = /i.test(q)
    )
    expect(probes).toEqual([])
  })
})
