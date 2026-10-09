import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  conversationMessages,
  conversations,
  postCommentReactions,
  postComments,
  postVotes,
  posts,
  principal,
  sql,
  user,
} from '@/lib/server/db'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { listPortalUsers } from '../user.service'
import { getPortalUserDetail } from '../user.detail'
import { getPublicUserProfile } from '../user.public-profile'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ marker: principal.testOwnerPrincipalId }).from(principal).limit(0)
  },
})
let boardId: BoardId, owner: PrincipalId, other: PrincipalId, testCustomer: PrincipalId
let label: string

async function person(type: 'user' | 'anonymous' = 'user') {
  const userId = createId('user')
  const id = createId('principal')
  await testDb.insert(user).values({ id: userId, name: label, email: `${userId}@example.com` })
  await testDb.insert(principal).values({ id, userId, type, role: 'user', createdAt: new Date() })
  return id
}

async function post(by: PrincipalId, metadata: Record<string, unknown> | null = null) {
  const id = createId('post')
  await testDb.insert(posts).values({
    id,
    boardId,
    principalId: by,
    title: 'Acme idea',
    content: 'Please add this.',
    widgetMetadata: metadata as Record<string, string> | null,
  })
  return id
}

async function commentAndVote(by: PrincipalId, postId: PostId) {
  await testDb.insert(postComments).values({ postId, principalId: by, content: 'Acme comment' })
  await testDb.insert(postVotes).values({ postId, principalId: by })
}

/** Test content is what a test customer authored; engaging with it is not real activity. */
async function testActivity() {
  const testPostId = await post(testCustomer, { test: 'false' })
  await commentAndVote(owner, testPostId)
  return [testPostId]
}

async function realActivity() {
  const authored = await post(owner)
  const engaged = await post(other)
  await commentAndVote(owner, engaged)
  await testDb.insert(postComments).values({
    postId: authored,
    principalId: testCustomer,
    content: 'Acme test comment',
  })
  return { authored, engaged }
}

describe('test activity stays outside people and public profiles', () => {
  beforeEach(async () => {
    expect(fixture.available).toBe(true)
    await fixture.begin()
    const [database] = await testDb.execute(sql`select current_database() as name`)
    expect(String(database.name)).toMatch(/^quackback_test(?:_\w+)?$/)
    label = `Acme ${createId('user')}`
    owner = await person()
    other = await person()
    testCustomer = createId('principal')
    await testDb.insert(principal).values({
      id: testCustomer,
      type: 'anonymous',
      role: 'user',
      createdAt: new Date(),
      testOwnerPrincipalId: owner,
    })
    boardId = createId('board')
    await testDb.insert(boards).values({ id: boardId, name: 'Acme', slug: String(boardId) })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('keeps directory counters and count filters on real posts, comments and votes', async () => {
    await testActivity()
    await realActivity()
    const directory = await listPortalUsers({ search: label })
    expect(directory.items.find((item) => item.principalId === owner)).toMatchObject({
      postCount: 1,
      commentCount: 1,
      voteCount: 1,
    })
    for (const field of ['postCount', 'commentCount', 'voteCount'] as const) {
      const filtered = await listPortalUsers({ search: label, [field]: { op: 'gt', value: 1 } })
      expect(filtered.items).toHaveLength(0)
      expect(filtered.total).toBe(0)
    }
    // A legacy client marker on the person's own idea is real activity.
    await post(owner, { test: 'true' })
    const after = await listPortalUsers({ search: label })
    expect(after.items.find((item) => item.principalId === owner)?.postCount).toBe(2)
  })

  it('keeps user detail activity and per-post comments on real content', async () => {
    await testActivity()
    const real = await realActivity()
    const detail = await getPortalUserDetail(owner)
    expect(detail).toMatchObject({ postCount: 1, commentCount: 1, voteCount: 1 })
    expect(detail!.engagedPosts.map((item) => item.id).sort()).toEqual(
      [real.authored, real.engaged].sort()
    )
    expect(detail!.engagedPosts.find((item) => item.id === real.authored)?.commentCount).toBe(0)
  })

  it('hides test-only public profiles and keeps real activity lists and counts', async () => {
    await testActivity()
    expect(await getPublicUserProfile(owner, ANONYMOUS_ACTOR)).toBeNull()
    const real = await realActivity()
    const profile = await getPublicUserProfile(owner, ANONYMOUS_ACTOR)
    expect(profile).toMatchObject({ postCount: 1, commentCount: 1, voteCount: 1 })
    expect(profile!.posts.map((item) => item.postId)).toEqual([real.authored])
    expect(profile!.comments.map((item) => item.postId)).toEqual([real.engaged])
    expect(profile!.upvotes.map((item) => item.postId)).toEqual([real.engaged])
  })

  it('does not promote anonymous visitors with only test activity into Leads', async () => {
    const [commenter, voter, reactor, realLead, legacyLead] = await Promise.all(
      Array.from({ length: 5 }, () => person('anonymous'))
    )
    const testPost = await post(testCustomer)
    const [testComment] = await testDb
      .insert(postComments)
      .values({ postId: testPost, principalId: commenter, content: 'Acme test comment' })
      .returning({ id: postComments.id })
    await testDb.insert(postVotes).values({ postId: testPost, principalId: voter })
    await testDb.insert(postCommentReactions).values({
      commentId: testComment.id,
      principalId: reactor,
      emoji: '👍',
    })
    const [conversation] = await testDb
      .insert(conversations)
      .values({ visitorPrincipalId: testCustomer, channel: 'messenger' })
      .returning({ id: conversations.id })
    await testDb.insert(conversationMessages).values({
      conversationId: conversation.id,
      principalId: testCustomer,
      senderType: 'visitor',
      content: 'Acme test message',
    })
    await post(realLead)
    await post(legacyLead, { test: true })
    const leads = await listPortalUsers({ lifecycle: 'leads', search: label })
    expect(leads.items.map((item) => item.principalId).sort()).toEqual(
      [realLead, legacyLead].sort()
    )
    expect(leads.total).toBe(2)
  })
})
