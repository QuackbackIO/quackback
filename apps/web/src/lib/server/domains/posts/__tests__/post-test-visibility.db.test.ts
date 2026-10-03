import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PostId, type PrincipalId, type PostCommentId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  inAppNotifications,
  postCommentReactions,
  postComments,
  postSubscriptions,
  posts,
  principal,
  sql,
  user,
  eq,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPublicPosts } from '../post.public'
import { getPublicPostDetail } from '../post.public.detail'
import { assertPostViewable, assertPostVotable, assertCommentViewable } from '../post.access'
import { addReaction, removeReaction } from '../../comments/comment.reactions'
import { getPostMergeInfo } from '../post.merge'
import { getNotificationsForMember } from '../../notifications/notification.service'
import { getSubscriberTargets, getMentionTargets } from '@/lib/server/events/targets'
import type {
  PostStatusChangedEvent,
  PostMentionedEvent,
  CommentCreatedEvent,
} from '@/lib/server/events/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ marker: principal.testOwnerPrincipalId }).from(principal).limit(0)
  },
})
let team: Actor, customer: Actor, otherCustomer: Actor, visitor: Actor
let testPost: PostId, otherTestPost: PostId, realPost: PostId
let testComment: PostCommentId
let boardSlug: string

function actor(
  id: PrincipalId,
  role: 'admin' | 'user',
  principalType: 'user' | 'anonymous'
): Actor {
  return { principalId: id, role, principalType, segmentIds: new Set() }
}

async function teamMember() {
  const userId = createId('user')
  const id = createId('principal')
  await testDb.insert(user).values({ id: userId, name: 'Acme' })
  await testDb
    .insert(principal)
    .values({ id, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return id
}

describe('test feedback stays inside its customer session and team workspace', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    const [database] = await testDb.execute(sql`select current_database() as name`)
    expect(String(database.name)).toMatch(/^quackback_test(?:_\w+)?$/)
    const owner = await teamMember()
    const otherOwner = await teamMember()
    const customerId = createId('principal'),
      otherCustomerId = createId('principal')
    const visitorId = createId('principal')
    await testDb.insert(principal).values([
      {
        id: customerId,
        role: 'user',
        type: 'anonymous',
        createdAt: new Date(),
        testOwnerPrincipalId: owner,
      },
      {
        id: otherCustomerId,
        role: 'user',
        type: 'anonymous',
        createdAt: new Date(),
        testOwnerPrincipalId: otherOwner,
      },
      { id: visitorId, role: 'user', type: 'user', createdAt: new Date() },
    ])
    team = actor(owner, 'admin', 'user')
    customer = {
      ...actor(customerId, 'user', 'anonymous'),
      testFeedback: { ownerPrincipalId: owner, active: true, canView: true, canSubmit: true },
    } as Actor
    otherCustomer = {
      ...actor(otherCustomerId, 'user', 'anonymous'),
      testFeedback: { ownerPrincipalId: otherOwner, active: true, canView: true, canSubmit: true },
    } as Actor
    visitor = actor(visitorId, 'user', 'user')
    const boardId = createId('board')
    boardSlug = String(boardId)
    await testDb.insert(boards).values({ id: boardId, name: 'Acme', slug: boardSlug })
    ;((testPost = createId('post')),
      (otherTestPost = createId('post')),
      (realPost = createId('post')))
    await testDb.insert(posts).values([
      {
        id: testPost,
        boardId,
        principalId: customerId,
        title: 'Acme test idea',
        content: 'Please',
      },
      {
        id: otherTestPost,
        boardId,
        principalId: otherCustomerId,
        title: 'Acme other test idea',
        content: 'Please',
      },
      { id: realPost, boardId, principalId: visitorId, title: 'Acme real idea', content: 'Please' },
    ])
    testComment = createId('post_comment')
    await testDb.insert(postComments).values({
      id: testComment,
      postId: testPost,
      principalId: customerId,
      content: 'Acme test comment',
    })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('lists real posts for visitors, the own test post for its customer, and all posts for the team', async () => {
    for (const viewer of [ANONYMOUS_ACTOR, visitor]) {
      const result = await listPublicPosts({ boardSlug, actor: viewer })
      expect(result.items.map((post) => post.id)).toEqual([realPost])
    }
    expect(
      (await listPublicPosts({ boardSlug, actor: customer })).items.map((post) => post.id)
    ).toEqual([testPost])
    expect(
      (await listPublicPosts({ boardSlug, actor: team })).items.map((post) => post.id).sort()
    ).toEqual([testPost, otherTestPost, realPost].sort())
  })

  it('contains direct post detail and refuses revoked test sessions', async () => {
    for (const viewer of [ANONYMOUS_ACTOR, visitor, otherCustomer]) {
      expect(await getPublicPostDetail(testPost, viewer)).toBeNull()
    }
    expect(await getPublicPostDetail(testPost, customer)).toMatchObject({ id: testPost })
    expect(await getPublicPostDetail(testPost, team)).toMatchObject({ id: testPost })
    expect(await getPublicPostDetail(realPost, customer)).toBeNull()
    const revoked = {
      ...customer,
      testFeedback: {
        ownerPrincipalId: team.principalId!,
        active: false,
        canView: false,
        canSubmit: false,
      },
    } as Actor
    expect(await getPublicPostDetail(testPost, revoked)).toBeNull()
    expect((await listPublicPosts({ boardSlug, actor: revoked })).items).toHaveLength(0)
  })

  it('checks the same scope before post, vote and comment mutations', async () => {
    for (const viewer of [ANONYMOUS_ACTOR, visitor, otherCustomer]) {
      await expect(assertPostViewable(testPost, viewer)).rejects.toMatchObject({
        code: 'POST_NOT_FOUND',
      })
      await expect(assertPostVotable(testPost, viewer)).rejects.toMatchObject({
        code: 'POST_NOT_FOUND',
      })
      await expect(assertCommentViewable(testComment, viewer)).rejects.toMatchObject({
        code: 'COMMENT_NOT_FOUND',
      })
    }
    for (const viewer of [customer, team]) {
      await expect(assertPostViewable(testPost, viewer)).resolves.toBeUndefined()
      await expect(assertPostVotable(testPost, viewer)).resolves.toBeUndefined()
      await expect(assertCommentViewable(testComment, viewer)).resolves.toBeUndefined()
    }
    await expect(assertPostViewable(realPost, visitor)).resolves.toBeUndefined()
  })

  it('does not disclose a test canonical through a merged source redirect', async () => {
    await testDb
      .update(posts)
      .set({ canonicalPostId: testPost, mergedAt: new Date() })
      .where(eq(posts.id, realPost))
    for (const viewer of [ANONYMOUS_ACTOR, visitor, otherCustomer]) {
      expect(await getPostMergeInfo(realPost, viewer)).toBeNull()
    }
    for (const viewer of [team, customer]) {
      expect(await getPostMergeInfo(realPost, viewer)).toMatchObject({ canonicalPostId: testPost })
    }
  })

  it('hides test-customer comments and reactions on real posts from ordinary visitors', async () => {
    const realCommentId = createId('post_comment'),
      testCommentId = createId('post_comment')
    await testDb.insert(postComments).values([
      {
        id: realCommentId,
        postId: realPost,
        principalId: visitor.principalId!,
        content: 'Acme real comment',
      },
      {
        id: testCommentId,
        postId: realPost,
        principalId: customer.principalId!,
        content: 'Acme test comment',
      },
    ])
    await testDb.insert(postCommentReactions).values([
      { commentId: realCommentId, principalId: visitor.principalId!, emoji: '👍' },
      { commentId: realCommentId, principalId: customer.principalId!, emoji: '👍' },
    ])
    const publicDetail = await getPublicPostDetail(realPost, ANONYMOUS_ACTOR)
    expect(publicDetail!.comments.map((comment) => comment.id)).toEqual([realCommentId])
    expect(publicDetail!.commentsTotalRootCount).toBe(1)
    expect(publicDetail!.comments[0].reactions[0].count).toBe(1)
    const added = await addReaction(realCommentId, '👍', visitor.principalId!, visitor)
    expect(added.reactions[0].count).toBe(1)
    const removed = await removeReaction(realCommentId, '👍', visitor.principalId!, visitor)
    expect(removed.reactions).toHaveLength(0)
    await addReaction(realCommentId, '👍', visitor.principalId!, visitor)
    const teamDetail = await getPublicPostDetail(realPost, team)
    expect(teamDetail!.comments.map((comment) => comment.id).sort()).toEqual(
      [realCommentId, testCommentId].sort()
    )
    expect(
      teamDetail!.comments.find((comment) => comment.id === realCommentId)!.reactions[0].count
    ).toBe(1)
    await expect(assertCommentViewable(testCommentId, visitor)).rejects.toMatchObject({
      code: 'COMMENT_NOT_FOUND',
    })
  })

  it('redacts stored test post notifications but preserves real and team previews', async () => {
    const rows = [realPost, testPost].map((postId) => ({
      principalId: visitor.principalId!,
      type: 'post_status_changed',
      postId,
      title: postId === realPost ? 'Acme real title' : 'Acme test title',
      body: postId === realPost ? 'Acme real body' : 'Acme test body',
      metadata: { postTitle: postId === realPost ? 'Acme real idea' : 'Acme test idea' },
    }))
    await testDb.insert(inAppNotifications).values(rows)
    const notifications = (await getNotificationsForMember(visitor.principalId!, {}, visitor))
      .notifications
    expect(notifications.find((row) => row.postId === realPost)).toMatchObject({
      title: 'Acme real title',
      body: 'Acme real body',
      metadata: { postTitle: 'Acme real idea' },
      post: { id: realPost },
    })
    const test = notifications.find((row) => row.postId === testPost)!
    expect(test.post).toBeNull()
    expect(test.title).not.toContain('Acme test')
    expect(test.body).not.toContain('Acme test')
    expect(test.metadata).toBeNull()
    expect(
      (await getNotificationsForMember(visitor.principalId!, {}, team)).notifications.find(
        (row) => row.postId === testPost
      )
    ).toMatchObject({ title: 'Acme test title', post: { id: testPost } })
    await testDb
      .insert(inAppNotifications)
      .values({ ...rows[1], principalId: customer.principalId! })
    expect(
      (await getNotificationsForMember(customer.principalId!, {}, customer)).notifications.find(
        (row) => row.postId === testPost
      )
    ).toMatchObject({ title: 'Acme test title', post: { id: testPost } })
    await testDb.update(posts).set({ widgetMetadata: null }).where(eq(posts.id, testPost))
    expect(
      (await getNotificationsForMember(visitor.principalId!, {}, visitor)).notifications.find(
        (row) => row.postId === testPost
      )!.post
    ).toBeNull()
  })

  it('keeps direct subscriber delivery from carrying test posts or test-customer comments', async () => {
    const userId = createId('user')
    await testDb.insert(user).values({ id: userId, name: 'Acme', email: 'you@example.com' })
    await testDb.update(principal).set({ userId }).where(eq(principal.id, visitor.principalId!))
    await testDb.insert(postSubscriptions).values(
      [realPost, testPost].map((postId) => ({
        postId,
        principalId: visitor.principalId!,
        reason: 'manual',
      }))
    )
    const context = { workspaceName: 'Acme', portalBaseUrl: 'http://localhost:3100', logoUrl: null }
    const status = (postId: PostId): PostStatusChangedEvent => ({
      id: createId('event'),
      type: 'post.status_changed',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: team.principalId! },
      data: {
        post: { id: postId, title: 'Acme', boardId: boardSlug, boardSlug },
        previousStatus: 'Planned',
        newStatus: 'In progress',
      },
    })
    const realTargets = await getSubscriberTargets(status(realPost), context)
    expect(realTargets.some((target) => target.type === 'notification')).toBe(true)
    expect(realTargets.some((target) => target.type === 'email')).toBe(true)
    expect(await getSubscriberTargets(status(testPost), context)).toEqual([])
    const testOnReal = createId('post_comment')
    await testDb.insert(postComments).values({
      id: testOnReal,
      postId: realPost,
      principalId: customer.principalId!,
      content: 'Acme test comment',
    })
    const comment: CommentCreatedEvent = {
      ...status(realPost),
      type: 'comment.created',
      data: {
        post: status(realPost).data.post,
        comment: { id: testOnReal, content: 'Acme test comment' },
      },
    }
    expect(await getSubscriberTargets(comment, context)).toEqual([])
  })

  it('keeps direct mention delivery inside the workspace for test posts', async () => {
    const userId = createId('user')
    await testDb.insert(user).values({ id: userId, name: 'Acme', email: 'you@example.com' })
    await testDb.update(principal).set({ userId }).where(eq(principal.id, visitor.principalId!))
    const context = { workspaceName: 'Acme', portalBaseUrl: 'http://localhost:3100', logoUrl: null }
    const mention = (postId: PostId): PostMentionedEvent => ({
      id: createId('event'),
      type: 'post.mentioned',
      timestamp: new Date().toISOString(),
      actor: { type: 'user', principalId: team.principalId! },
      data: {
        postId,
        postTitle: 'Acme',
        postUrl: `http://localhost:3100/b/${boardSlug}/p/${postId}`,
        mentionedPrincipalId: visitor.principalId!,
        mentioningPrincipalId: team.principalId!,
        excerpt: 'Acme',
      },
    })
    const realTargets = await getMentionTargets(mention(realPost), context)
    expect(realTargets.some((target) => target.type === 'notification')).toBe(true)
    expect(realTargets.some((target) => target.type === 'email')).toBe(true)
    expect(await getMentionTargets(mention(testPost), context)).toEqual([])
  })
})
