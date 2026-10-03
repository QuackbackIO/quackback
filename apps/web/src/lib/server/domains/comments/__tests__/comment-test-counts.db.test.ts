import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, isTypeId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  postComments,
  posts,
  postStatuses,
  principal,
  sql,
  user,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { DEFAULT_PORTAL_CONFIG } from '@/lib/server/domains/settings/settings.types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
const settingsState = vi.hoisted(() => ({ holdLinks: false }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: async (freshness = 'cached') => {
    expect(freshness).toBe('cached')
    return {
      ...DEFAULT_PORTAL_CONFIG,
      moderationDefault: {
        ...DEFAULT_PORTAL_CONFIG.moderationDefault,
        holdLinks: settingsState.holdLinks,
      },
    }
  },
}))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: async (input: {
    postId: string
    principalId: string
    type: string
    metadata: unknown
  }) => {
    expect(isTypeId(input.postId, 'post')).toBe(true)
    expect(isTypeId(input.principalId, 'principal')).toBe(true)
    expect(input.type).toMatch(/^comment\.|^status\./)
    expect(input.metadata).toBeDefined()
  },
}))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  dispatchCommentCreated: async (actor: unknown, comment: { id: string }, post: { id: string }) => {
    expect(actor).toBeDefined()
    expect(isTypeId(comment.id, 'post_comment')).toBe(true)
    expect(isTypeId(post.id, 'post')).toBe(true)
  },
  dispatchCommentDeleted: async (actor: unknown, comment: { id: string }, post: { id: string }) => {
    expect(actor).toBeDefined()
    expect(isTypeId(comment.id, 'post_comment')).toBe(true)
    expect(isTypeId(post.id, 'post')).toBe(true)
  },
  dispatchCommentUpdated: async (actor: unknown, comment: { id: string }, post: { id: string }) => {
    expect(actor).toBeDefined()
    expect(isTypeId(comment.id, 'post_comment')).toBe(true)
    expect(isTypeId(post.id, 'post')).toBe(true)
  },
}))

import { createComment, deleteComment } from '../comment.service'
import { restoreComment } from '../comment.pin'
import { softDeleteComment, userEditComment } from '../comment.permissions'
import { approveComment } from '../../moderation/moderation.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ marker: principal.testOwnerPrincipalId }).from(principal).limit(0)
  },
})
let team: Actor, realAuthor: PrincipalId, testAuthor: PrincipalId
let realPost: PostId, testPost: PostId

async function rawComment(
  by: PrincipalId,
  state: 'published' | 'pending' = 'published',
  deletedAt?: Date
) {
  const id = createId('post_comment')
  await testDb.insert(postComments).values({
    id,
    postId: realPost,
    principalId: by,
    content: 'Acme comment',
    moderationState: state,
    deletedAt,
  })
  return id
}
async function count(postId = realPost) {
  const row = await testDb.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { commentCount: true },
  })
  return row!.commentCount
}
const teamCommentActor = () => ({ principalId: team.principalId!, role: 'admin' as const })

describe('test comments never change stored post counts', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    const [database] = await testDb.execute(sql`select current_database() as name`)
    expect(String(database.name)).toMatch(/^quackback_test(?:_\w+)?$/)
    settingsState.holdLinks = false
    const ownerId = createId('principal'),
      userId = createId('user')
    await testDb.insert(user).values({ id: userId, name: 'Acme' })
    await testDb
      .insert(principal)
      .values({ id: ownerId, userId, type: 'user', role: 'admin', createdAt: new Date() })
    ;((realAuthor = createId('principal')), (testAuthor = createId('principal')))
    await testDb.insert(principal).values([
      { id: realAuthor, type: 'user', role: 'user', createdAt: new Date() },
      {
        id: testAuthor,
        type: 'anonymous',
        role: 'user',
        createdAt: new Date(),
        testOwnerPrincipalId: ownerId,
      },
    ])
    team = { principalId: ownerId, role: 'admin', principalType: 'user', segmentIds: new Set() }
    const boardId = createId('board')
    await testDb.insert(boards).values({ id: boardId, name: 'Acme', slug: String(boardId) })
    ;((realPost = createId('post')), (testPost = createId('post')))
    await testDb.insert(posts).values([
      {
        id: realPost,
        boardId,
        principalId: realAuthor,
        title: 'Acme real idea',
        content: 'Please',
      },
      {
        id: testPost,
        boardId,
        principalId: testAuthor,
        title: 'Acme test idea',
        content: 'Please',
      },
    ])
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('counts real creation and excludes test authors and test posts in both creation paths', async () => {
    const real = { principalId: realAuthor, role: 'user' as const }
    await createComment({ postId: realPost, content: 'Acme real comment' }, real, team, {
      skipDispatch: true,
    })
    expect(await count()).toBe(1)
    await createComment(
      { postId: realPost, content: 'Acme test comment' },
      { principalId: testAuthor, role: 'user' },
      team,
      { skipDispatch: true }
    )
    expect(await count()).toBe(1)
    const statusId = createId('post_status')
    await testDb.insert(postStatuses).values({ id: statusId, name: 'Acme', slug: String(statusId) })
    await createComment(
      { postId: testPost, content: 'Acme status reply', statusId },
      { principalId: team.principalId!, role: 'admin' },
      team,
      { skipDispatch: true }
    )
    expect(await count(testPost)).toBe(0)
    expect((await testDb.query.posts.findFirst({ where: eq(posts.id, testPost) }))!.statusId).toBe(
      statusId
    )
    await createComment(
      { postId: realPost, content: 'Acme status reply', statusId },
      { principalId: team.principalId!, role: 'admin' },
      team,
      { skipDispatch: true }
    )
    expect(await count()).toBe(2)
  })

  it('keeps real counts through test soft-delete, restore, and hard-delete', async () => {
    await rawComment(realAuthor)
    await testDb.update(posts).set({ commentCount: 1 }).where(eq(posts.id, realPost))
    const test = await rawComment(testAuthor)
    await softDeleteComment(test, teamCommentActor())
    expect(await count()).toBe(1)
    await restoreComment(test, teamCommentActor())
    expect(await count()).toBe(1)
    await deleteComment(test, teamCommentActor())
    expect(await count()).toBe(1)
  })

  it('approves real comments but never counts approved or restored test comments', async () => {
    await rawComment(realAuthor)
    await testDb.update(posts).set({ commentCount: 1 }).where(eq(posts.id, realPost))
    const test = await rawComment(testAuthor, 'pending')
    await approveComment(test, { actor: { role: 'admin', type: 'user' } })
    expect(await count()).toBe(1)
    const real = await rawComment(realAuthor, 'pending')
    await approveComment(real, { actor: { role: 'admin', type: 'user' } })
    expect(await count()).toBe(2)
  })

  it('does not subtract uncounted test comments when an edit becomes pending', async () => {
    const real = await rawComment(realAuthor)
    const test = await rawComment(testAuthor)
    await testDb.update(posts).set({ commentCount: 1 }).where(eq(posts.id, realPost))
    settingsState.holdLinks = true
    await userEditComment(test, '[Acme](https://example.com)', {
      principalId: testAuthor,
      role: 'user',
    })
    expect(await count()).toBe(1)
    await userEditComment(real, '[Acme](https://example.com)', {
      principalId: realAuthor,
      role: 'user',
    })
    expect(await count()).toBe(0)
  })

  it('does not subtract test descendants when hard-deleting a comment tree', async () => {
    const testRoot = await rawComment(testAuthor)
    await testDb.insert(postComments).values({
      postId: realPost,
      parentId: testRoot,
      principalId: testAuthor,
      content: 'Acme test reply',
    })
    const real = await rawComment(realAuthor)
    await testDb.update(posts).set({ commentCount: 1 }).where(eq(posts.id, realPost))
    await deleteComment(testRoot, teamCommentActor())
    expect(await count()).toBe(1)
    await deleteComment(real, teamCommentActor())
    expect(await count()).toBe(0)
  })
})
