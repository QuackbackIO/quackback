/**
 * The inbox Team response filter (FBA-I-11): only a public team reply the
 * author can read is a response. A private internal note, or a team comment
 * still held for moderation, leaves the post unresponded, in the list and in
 * the counts alike.
 *
 * Real Postgres in a rolled-back transaction: the predicate is raw SQL.
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

const fixture = await createDbTestFixture()

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedTeammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `T-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedBoard(): Promise<BoardId> {
  const [board] = await testDb
    .insert(boards)
    .values({ slug: `team-response-${suffix()}`, name: 'Board', access: DEFAULT_BOARD_ACCESS })
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

async function teamComment(
  postId: PostId,
  author: PrincipalId,
  extra: { isPrivate?: boolean; moderationState?: 'pending' | 'published' } = {}
) {
  await testDb
    .insert(postComments)
    .values({ postId, principalId: author, content: 'reply', isTeamMember: true, ...extra })
}

describe.skipIf(!fixture.available)('inbox Team response filter (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('treats a private note and a held team comment as no response', async () => {
    const teammate = await seedTeammate()
    const boardId = await seedBoard()
    const replied = await seedPost(boardId, teammate, 'Replied')
    const noted = await seedPost(boardId, teammate, 'Noted privately')
    const held = await seedPost(boardId, teammate, 'Held reply')
    await seedPost(boardId, teammate, 'Quiet')
    await teamComment(replied, teammate)
    await teamComment(noted, teammate, { isPrivate: true })
    await teamComment(held, teammate, { moderationState: 'pending' })

    const responded = await listInboxPosts({ boardIds: [boardId], responded: 'responded' })
    expect(responded.items.map((p) => p.title)).toEqual(['Replied'])

    const unresponded = await listInboxPosts({ boardIds: [boardId], responded: 'unresponded' })
    expect(unresponded.items.map((p) => p.title).sort()).toEqual([
      'Held reply',
      'Noted privately',
      'Quiet',
    ])

    const counts = await countInboxFilterFacets({ boardIds: [boardId] })
    expect(counts.responded).toEqual({ responded: 1, unresponded: 3 })
  })
})
