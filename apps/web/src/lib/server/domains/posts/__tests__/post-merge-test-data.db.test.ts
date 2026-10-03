import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, postComments, postVotes, posts, principal, user, eq, sql } from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

const effects = vi.hoisted(() => ({
  scheduleDispatch: vi.fn(),
  dispatchPostMerged: vi.fn(),
  createActivity: vi.fn(),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/scheduler', () => ({ scheduleDispatch: effects.scheduleDispatch }))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  dispatchPostMerged: effects.dispatchPostMerged,
}))
vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: effects.createActivity,
}))

import { getOrCreateTestCustomer } from '@/lib/server/test-customer'
import { mergePost } from '../post.merge'

const fixture = await createDbTestFixture()
let owner: PrincipalId, teammate: PrincipalId, customer: PrincipalId, boardId: BoardId
let source: PostId, target: PostId

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  vi.clearAllMocks()
  effects.scheduleDispatch.mockResolvedValue(undefined)
  owner = createId('principal')
  teammate = createId('principal')
  boardId = createId('board')
  source = createId('post')
  target = createId('post')
  const ownerUser = createId('user'),
    teammateUser = createId('user')
  await testDb.insert(user).values([
    { id: ownerUser, name: 'Acme', email: 'you@example.com' },
    { id: teammateUser, name: 'Acme', email: 'other@example.com' },
  ])
  await testDb.insert(principal).values([
    { id: owner, userId: ownerUser, type: 'user', role: 'admin', createdAt: new Date() },
    { id: teammate, userId: teammateUser, type: 'user', role: 'member', createdAt: new Date() },
  ])
  customer = (await getOrCreateTestCustomer(owner, 'en')).id
  await testDb
    .insert(boards)
    .values({ id: boardId, name: 'Feedback', slug: String(boardId), access: DEFAULT_BOARD_ACCESS })
  await testDb.insert(posts).values([
    {
      id: source,
      boardId,
      principalId: teammate,
      title: 'Acme source',
      content: '',
      voteCount: 1,
      commentCount: 1,
    },
    {
      id: target,
      boardId,
      principalId: owner,
      title: 'Acme target',
      content: '',
      voteCount: 1,
      commentCount: 0,
    },
  ])
  await testDb.insert(postVotes).values([
    { postId: source, principalId: teammate },
    { postId: target, principalId: owner },
  ])
  await testDb.insert(postComments).values({
    postId: source,
    principalId: teammate,
    content: 'A real teammate reply',
    moderationState: 'published',
  })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

it.each(['source', 'target'] as const)(
  'refuses a %s test-customer idea without moving real teammate votes or comments',
  async (position) => {
    const id = position === 'source' ? source : target
    await testDb.update(posts).set({ principalId: customer }).where(eq(posts.id, id))
    await expect(mergePost(source, target, owner)).rejects.toMatchObject({ code: 'POST_NOT_FOUND' })
    expect(await testDb.query.posts.findFirst({ where: eq(posts.id, source) })).toMatchObject({
      canonicalPostId: null,
      voteCount: 1,
      commentCount: 1,
    })
    expect(await testDb.query.posts.findFirst({ where: eq(posts.id, target) })).toMatchObject({
      canonicalPostId: null,
      voteCount: 1,
      commentCount: 0,
    })
    expect(effects.createActivity).not.toHaveBeenCalled()
    expect(effects.scheduleDispatch).not.toHaveBeenCalled()
    expect(effects.dispatchPostMerged).not.toHaveBeenCalled()
  }
)

it.each([{ test: true }, { test: 'true' }, { onboardingGenerated: true }])(
  'merges a real idea carrying the legacy client attributes %j',
  async (metadata) => {
    await testDb
      .update(posts)
      .set({ widgetMetadata: sql`${JSON.stringify(metadata)}::jsonb` })
      .where(eq(posts.id, source))
    await expect(mergePost(source, target, owner)).resolves.toMatchObject({
      canonicalPost: { id: target, voteCount: 2 },
    })
  }
)

it('keeps ordinary merge aggregation, activity and fan-out working', async () => {
  const result = await mergePost(source, target, owner)
  expect(result).toEqual({
    canonicalPost: { id: target, voteCount: 2 },
    duplicatePost: { id: source },
  })
  expect(await testDb.query.posts.findFirst({ where: eq(posts.id, source) })).toMatchObject({
    canonicalPostId: target,
  })
  expect(await testDb.query.posts.findFirst({ where: eq(posts.id, target) })).toMatchObject({
    voteCount: 2,
    commentCount: 1,
  })
  expect(effects.createActivity).toHaveBeenCalledWith(
    expect.objectContaining({ postId: target, type: 'post.merged_in' })
  )
  expect(effects.createActivity).toHaveBeenCalledWith(
    expect.objectContaining({ postId: source, type: 'post.merged_away' })
  )
  expect(effects.scheduleDispatch).toHaveBeenCalledWith(
    expect.objectContaining({ payload: { postId: target } })
  )
  expect(effects.dispatchPostMerged).toHaveBeenCalledWith(
    expect.objectContaining({ principalId: owner }),
    expect.objectContaining({ id: source, boardId }),
    expect.objectContaining({ id: target, boardId })
  )
})
