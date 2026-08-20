/**
 * Real-DB coverage for removePortalUser's authored-content re-attribution.
 *
 * Only Postgres can prove this: the failure being guarded against is the
 * ON DELETE RESTRICT foreign keys on posts / post_comments / conversations
 * aborting the principal delete, which a mocked executor cannot reproduce.
 * Each test runs inside the db-test-fixture rollback transaction, so
 * quackback_test stays clean, and the global `db` is rebound to that
 * transaction so the real service (and its own db.transaction, which becomes
 * a savepoint) runs unmodified.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type BoardId,
  type ConversationId,
  type PostCommentId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  conversationMessages,
  conversations,
  eq,
  postComments,
  posts,
  postVotes,
  principal,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

import { DELETED_USER_PRINCIPAL_ID } from '@/lib/server/domains/principals/principal-reattribute'
import { removePortalUser } from '../user.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: principal.id, name: principal.displayName }).from(principal).limit(0)
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: posts.id, author: posts.principalId }).from(posts).limit(0)
    await db
      .select({ id: postComments.id, author: postComments.principalId })
      .from(postComments)
      .limit(0)
    await db.select({ visitor: conversations.visitorPrincipalId }).from(conversations).limit(0)
    await db
      .select({ author: conversationMessages.principalId })
      .from(conversationMessages)
      .limit(0)
  },
})

const runSuffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedPortalUser(name: string): Promise<{ userId: UserId; principalId: PrincipalId }> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name, email: `${name.toLowerCase()}-${runSuffix()}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: name,
    createdAt: new Date(),
  })
  return { userId, principalId }
}

async function seedBoard(): Promise<BoardId> {
  const boardId = createId('board') as BoardId
  await testDb
    .insert(boards)
    .values({ id: boardId, slug: `remove-user-${runSuffix()}`, name: 'Removal fixture board' })
  return boardId
}

async function seedPost(boardId: BoardId, author: PrincipalId, title: string): Promise<PostId> {
  const postId = createId('post') as PostId
  await testDb
    .insert(posts)
    .values({ id: postId, boardId, title, content: 'Seeded content', principalId: author })
  return postId
}

describe.skipIf(!fixture.available)('removePortalUser (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('removes an author and re-attributes their post to the deleted-user placeholder', async () => {
    const author = await seedPortalUser('Authoring Ada')
    const boardId = await seedBoard()
    const postId = await seedPost(boardId, author.principalId, 'Please add dark mode')

    await expect(removePortalUser(author.principalId)).resolves.toBeUndefined()

    const [gone] = await testDb
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.id, author.principalId))
    expect(gone).toBeUndefined()

    const [post] = await testDb.select().from(posts).where(eq(posts.id, postId))
    expect(post.title).toBe('Please add dark mode')
    expect(post.principalId).toBe(DELETED_USER_PRINCIPAL_ID)

    const [placeholder] = await testDb
      .select()
      .from(principal)
      .where(eq(principal.id, DELETED_USER_PRINCIPAL_ID))
    expect(placeholder).toMatchObject({ role: 'user', type: 'user', userId: null })
    expect(placeholder.displayName).toBe('Deleted user')
  })

  it('re-attributes comments and conversation threads, and cascades derived rows away', async () => {
    const author = await seedPortalUser('Chatty Chris')
    const boardId = await seedBoard()
    const postId = await seedPost(boardId, author.principalId, 'Bug in the exporter')

    const commentId = createId('post_comment') as PostCommentId
    await testDb.insert(postComments).values({
      id: commentId,
      postId,
      principalId: author.principalId,
      content: 'Still broken on 1.4',
    })

    const conversationId = createId('conversation') as ConversationId
    await testDb
      .insert(conversations)
      .values({ id: conversationId, visitorPrincipalId: author.principalId, channel: 'messenger' })
    await testDb.insert(conversationMessages).values({
      conversationId,
      principalId: author.principalId,
      senderType: 'visitor',
      content: 'any update?',
    })

    await testDb.insert(postVotes).values({ postId, principalId: author.principalId })

    await removePortalUser(author.principalId)

    const [comment] = await testDb.select().from(postComments).where(eq(postComments.id, commentId))
    expect(comment.content).toBe('Still broken on 1.4')
    expect(comment.principalId).toBe(DELETED_USER_PRINCIPAL_ID)

    const [conversation] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    expect(conversation.visitorPrincipalId).toBe(DELETED_USER_PRINCIPAL_ID)

    const [message] = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversationId))
    expect(message.principalId).toBe(DELETED_USER_PRINCIPAL_ID)

    // Votes are ON DELETE CASCADE: they are entitlement, not authored content,
    // and go with the principal rather than moving to the placeholder.
    const votes = await testDb.select().from(postVotes).where(eq(postVotes.postId, postId))
    expect(votes).toHaveLength(0)
  })

  it('reuses one placeholder across removals and refuses to remove the placeholder itself', async () => {
    const boardId = await seedBoard()
    const first = await seedPortalUser('First Fran')
    const second = await seedPortalUser('Second Sam')
    const firstPost = await seedPost(boardId, first.principalId, 'First idea')
    const secondPost = await seedPost(boardId, second.principalId, 'Second idea')

    await removePortalUser(first.principalId)
    await removePortalUser(second.principalId)

    const placeholders = await testDb
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.id, DELETED_USER_PRINCIPAL_ID))
    expect(placeholders).toHaveLength(1)

    const rows = await testDb
      .select({ id: posts.id, author: posts.principalId })
      .from(posts)
      .where(eq(posts.principalId, DELETED_USER_PRINCIPAL_ID))
    expect(rows.map((r) => r.id).sort()).toEqual([firstPost, secondPost].sort())

    await expect(removePortalUser(DELETED_USER_PRINCIPAL_ID)).rejects.toMatchObject({
      code: 'MEMBER_NOT_FOUND',
    })
    const [stillThere] = await testDb
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.id, DELETED_USER_PRINCIPAL_ID))
    expect(stillThere).toBeDefined()
  })
})
