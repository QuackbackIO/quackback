/**
 * Who may not comment on a board may not react there either, and nobody adds
 * a reaction on a read-only board. Taking a reaction back is always allowed.
 * Real Postgres in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  type BoardId,
  type PostCommentId,
  type PostId,
  type PrincipalId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postCommentReactions, postComments, posts, principal } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const { addReaction, removeReaction } = await import('../comment.reactions')

const fixture = await createDbTestFixture()

async function seedPrincipal(role: 'user' | 'admin'): Promise<PrincipalId> {
  const id = createId('principal') as PrincipalId
  await testDb.insert(principal).values({ id, role, type: 'user', createdAt: new Date() })
  return id
}

function actorFor(id: PrincipalId, role: 'user' | 'admin' = 'user'): Actor {
  return { principalId: id, role, principalType: 'user', segmentIds: new Set() }
}

async function seedComment(options: {
  comment?: 'anonymous' | 'authenticated' | 'team'
  readOnly?: boolean
}): Promise<PostCommentId> {
  const boardId = createId('board') as BoardId
  await testDb.insert(boards).values({
    id: boardId,
    name: 'Board',
    slug: `react-${Math.random().toString(36).slice(2, 10)}`,
    readOnly: options.readOnly ?? false,
    access: { ...DEFAULT_BOARD_ACCESS, comment: options.comment ?? 'anonymous' },
  })
  const postId = createId('post') as PostId
  const admin = await seedPrincipal('admin')
  await testDb
    .insert(posts)
    .values({ id: postId, boardId, title: 'Post', content: '', principalId: admin })
  const commentId = createId('post_comment') as PostCommentId
  await testDb.insert(postComments).values({
    id: commentId,
    postId,
    principalId: admin,
    content: 'Team words',
    isTeamMember: true,
  })
  return commentId
}

describe.skipIf(!fixture.available)('reaction gates (real DB)', () => {
  let customer: PrincipalId

  beforeEach(async () => {
    await fixture.begin()
    customer = await seedPrincipal('user')
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lets a customer react where they may comment', async () => {
    const comment = await seedComment({})
    expect((await addReaction(comment, '👍', customer, actorFor(customer))).added).toBe(true)
  })

  it('refuses a customer on a board where only the team comments', async () => {
    const comment = await seedComment({ comment: 'team' })
    await expect(addReaction(comment, '👍', customer, actorFor(customer))).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(await testDb.select().from(postCommentReactions)).toHaveLength(0)
  })

  it('still lets the team react on that board', async () => {
    const comment = await seedComment({ comment: 'team' })
    const admin = await seedPrincipal('admin')
    expect((await addReaction(comment, '👍', admin, actorFor(admin, 'admin'))).added).toBe(true)
  })

  it('refuses a new reaction on a read-only board, but takes one back', async () => {
    const comment = await seedComment({})
    await addReaction(comment, '👍', customer, actorFor(customer))
    await testDb.update(boards).set({ readOnly: true })
    await expect(addReaction(comment, '🎉', customer, actorFor(customer))).rejects.toMatchObject({
      statusCode: 403,
    })
    await removeReaction(comment, '👍', customer, actorFor(customer))
    expect(await testDb.select().from(postCommentReactions)).toHaveLength(0)
  })
})
