import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  principal,
  user,
  boards,
  posts,
  postVotes,
  postComments,
  postSubscriptions,
  eq,
  and,
} from '@/lib/server/db'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

const dispatchPostVoted = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/events/dispatch', async (original) => ({
  ...(await original<typeof import('@/lib/server/events/dispatch')>()),
  dispatchPostVoted,
}))

import { getOrCreateTestCustomer } from '@/lib/server/test-customer'
import { voteOnPost, addVoteOnBehalf, removeVote } from '../post.voting'
import { listPostVoters } from '../post.voters'
import { recalculateCanonicalVoteCount } from '../post.merge-ids'
import { getMergedPosts, previewMergedPost } from '../post.merge'

const fixture = await createDbTestFixture()
let owner: PrincipalId,
  customer: PrincipalId,
  ordinary: PrincipalId,
  boardId: BoardId,
  postId: PostId
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  dispatchPostVoted.mockReset()
  owner = createId('principal')
  ordinary = createId('principal')
  boardId = createId('board')
  postId = createId('post')
  const ownerUser = createId('user'),
    ordinaryUser = createId('user')
  await testDb.insert(user).values([
    { id: ownerUser, name: 'Acme', email: 'you@example.com' },
    { id: ordinaryUser, name: 'Acme', email: 'other@example.com' },
  ])
  await testDb.insert(principal).values([
    { id: owner, userId: ownerUser, type: 'user', role: 'admin', createdAt: new Date() },
    { id: ordinary, userId: ordinaryUser, type: 'user', role: 'user', createdAt: new Date() },
  ])
  customer = (await getOrCreateTestCustomer(owner, 'en')).id
  await testDb.insert(boards).values({
    id: boardId,
    name: 'Feedback',
    slug: String(boardId),
    access: DEFAULT_BOARD_ACCESS,
  })
  await testDb.insert(posts).values({
    id: postId,
    boardId,
    title: 'A real idea',
    content: '',
    principalId: owner,
    voteCount: 1,
  })
  await testDb.insert(postVotes).values({ postId, principalId: owner })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function count() {
  return (await testDb.query.posts.findFirst({ where: eq(posts.id, postId) }))!.voteCount
}

async function customerVote() {
  return testDb.query.postVotes.findFirst({
    where: and(eq(postVotes.postId, postId), eq(postVotes.principalId, customer)),
  })
}

it('lets a test customer toggle a real idea without changing its count or dispatching a vote event', async () => {
  expect(await voteOnPost(postId, customer)).toEqual({ voted: true, voteCount: 1 })
  expect(await customerVote()).toBeDefined()
  expect(await count()).toBe(1)
  expect(dispatchPostVoted).not.toHaveBeenCalled()
  expect(await voteOnPost(postId, customer)).toEqual({ voted: false, voteCount: 1 })
  expect(await customerVote()).toBeUndefined()
  expect(await count()).toBe(1)
})

it('does not count or subscribe an idempotent vote added on behalf of the test customer', async () => {
  expect(await addVoteOnBehalf(postId, customer)).toEqual({ voted: true, voteCount: 1 })
  expect(await customerVote()).toBeDefined()
  expect(await addVoteOnBehalf(postId, customer)).toEqual({ voted: false, voteCount: 1 })
  expect(await count()).toBe(1)
  expect(
    await testDb.query.postSubscriptions.findFirst({
      where: and(eq(postSubscriptions.postId, postId), eq(postSubscriptions.principalId, customer)),
    })
  ).toBeUndefined()
})

it('removes a test vote without subtracting a real vote', async () => {
  await testDb.insert(postVotes).values({ postId, principalId: customer })
  expect(await removeVote(postId, customer)).toEqual({ removed: true, voteCount: 1 })
  expect(await customerVote()).toBeUndefined()
  expect(await count()).toBe(1)
  expect(await removeVote(postId, customer)).toEqual({ removed: false, voteCount: 1 })
})

it('keeps test votes out of the voter list while keeping the real owner', async () => {
  await testDb.insert(postVotes).values({ postId, principalId: customer })
  const voters = await listPostVoters(postId)
  expect(voters.items.map((voter) => voter.principalId)).toEqual([owner])
})

it('does not restore test votes when a merge recount recomputes the stored count', async () => {
  await testDb.insert(postVotes).values({ postId, principalId: customer })
  expect(await recalculateCanonicalVoteCount(postId)).toBe(1)
  expect(await count()).toBe(1)
  await testDb.insert(postVotes).values({ postId, principalId: ordinary })
  expect(await recalculateCanonicalVoteCount(postId)).toBe(2)
  expect(await count()).toBe(2)
})

it('keeps test customer comments out of a merge recount while counting real comments', async () => {
  await testDb.insert(postComments).values([
    { postId, principalId: customer, content: 'A test reply', moderationState: 'published' },
    { postId, principalId: ordinary, content: 'A real reply', moderationState: 'published' },
  ])
  await recalculateCanonicalVoteCount(postId)
  expect((await testDb.query.posts.findFirst({ where: eq(posts.id, postId) }))!.commentCount).toBe(
    1
  )
})

it('excludes test votes from merge previews and merged-source vote counts', async () => {
  const sourceId = createId('post')
  await testDb.insert(posts).values({
    id: sourceId,
    boardId,
    title: 'A second idea',
    content: '',
    principalId: owner,
    voteCount: 1,
  })
  await testDb.insert(postVotes).values([
    { postId: sourceId, principalId: ordinary },
    { postId: sourceId, principalId: customer },
  ])
  expect((await previewMergedPost(postId, sourceId, owner)).post.voteCount).toBe(2)
  await testDb
    .update(posts)
    .set({ canonicalPostId: postId, mergedAt: new Date() })
    .where(eq(posts.id, sourceId))
  expect((await getMergedPosts(postId)).map((source) => source.voteCount)).toEqual([1])
})

it('continues counting ordinary customer votes, events and removals', async () => {
  expect(await voteOnPost(postId, ordinary)).toEqual({ voted: true, voteCount: 2 })
  expect(await count()).toBe(2)
  expect(dispatchPostVoted).toHaveBeenCalledOnce()
  expect(dispatchPostVoted).toHaveBeenCalledWith(
    expect.objectContaining({ principalId: ordinary }),
    expect.objectContaining({ id: postId, voteCount: 2 })
  )
  expect(await voteOnPost(postId, ordinary)).toEqual({ voted: false, voteCount: 1 })
  expect(await count()).toBe(1)
  expect(await addVoteOnBehalf(postId, ordinary)).toEqual({ voted: true, voteCount: 2 })
  expect(await removeVote(postId, ordinary)).toEqual({ removed: true, voteCount: 1 })
  expect(await count()).toBe(1)
})
