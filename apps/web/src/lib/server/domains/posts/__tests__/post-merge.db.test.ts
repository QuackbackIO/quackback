/**
 * Real-DB coverage for post merge aggregation.
 *
 * Merge only links the source (`canonical_post_id`); votes and comments stay
 * on their original rows. The survivor must still show the combined unique
 * vote count, the combined public comment count, the source comments in the
 * thread, and the source in getMergedPosts (the admin Unmerge list).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  postComments,
  postSubscriptions,
  postVotes,
  posts,
  principal,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostMerged: vi.fn(),
  dispatchPostUnmerged: vi.fn(),
  buildEventActor: vi.fn((actor) => actor),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

import { mergePost, unmergePost, getMergedPosts } from '../post.merge'
import {
  getSubscribersForEvent,
  getSubscriptionStatus,
  unsubscribeFromPost,
} from '../../subscriptions/subscription.service'
import { getCommentsWithReplies } from '../post.query'
import { hasUserVoted, getVoteAndSubscriptionStatus } from '../post.public.utils'
import { getPostVoters, listPostVoters } from '../post.voters'
import { voteOnPost } from '../post.voting'
import { getVotedPostIdsByUserId } from '../post.public'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, canonicalPostId: posts.canonicalPostId }).from(posts).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(name: string, email?: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, ...(email && { email }) })
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
      slug: `merge-${suffix()}`,
      name: 'Merge board',
      access: DEFAULT_BOARD_ACCESS,
    })
    .returning()
  return board.id
}

async function seedPost(opts: {
  boardId: BoardId
  principalId: PrincipalId
  title: string
  voteCount?: number
  commentCount?: number
}): Promise<PostId> {
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: opts.boardId,
      title: opts.title,
      content: '',
      principalId: opts.principalId,
      voteCount: opts.voteCount ?? 0,
      commentCount: opts.commentCount ?? 0,
    })
    .returning()
  return post.id
}

async function seedVote(postId: PostId, principalId: PrincipalId, createdAt?: Date): Promise<void> {
  await testDb.insert(postVotes).values({ postId, principalId, ...(createdAt && { createdAt }) })
}

async function seedComment(
  postId: PostId,
  principalId: PrincipalId,
  content: string,
  opts?: { moderationState?: 'published' | 'pending'; isPrivate?: boolean }
): Promise<void> {
  await testDb.insert(postComments).values({
    postId,
    principalId,
    content,
    isTeamMember: false,
    isPrivate: opts?.isPrivate ?? false,
    moderationState: opts?.moderationState ?? 'published',
  })
}

describe.skipIf(!fixture.available)('post merge aggregation (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('rolls unique votes and public comments onto the canonical and keeps the source listed', async () => {
    const actor = await seedPrincipal('Admin')
    const voterA = await seedPrincipal('Voter A')
    const voterB = await seedPrincipal('Voter B')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 1,
      commentCount: 1,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 1,
      commentCount: 1,
    })

    await seedVote(canonical, voterA)
    await seedVote(source, voterB)
    await seedComment(canonical, voterA, 'comment on canonical')
    await seedComment(source, voterB, 'comment on source')

    const result = await mergePost(source, canonical, actor)

    expect(result.canonicalPost.voteCount).toBe(2)

    const [canonicalRow] = await testDb.select().from(posts).where(eq(posts.id, canonical))
    expect(canonicalRow.voteCount).toBe(2)
    expect(canonicalRow.commentCount).toBe(2)

    const [sourceRow] = await testDb.select().from(posts).where(eq(posts.id, source))
    expect(sourceRow.canonicalPostId).toBe(canonical)

    const merged = await getMergedPosts(canonical)
    expect(merged.map((p) => p.id)).toEqual([source])

    const comments = await getCommentsWithReplies(canonical)
    expect(comments.map((c) => c.content).sort()).toEqual([
      'comment on canonical',
      'comment on source',
    ])

    expect(await hasUserVoted(canonical, voterB)).toBe(true)
    expect(await hasUserVoted(canonical, voterA)).toBe(true)

    const voters = await getPostVoters(canonical)
    expect(voters.map((v) => v.principalId).sort()).toEqual([voterA, voterB].sort())
  })

  it('counts overlapping voters once and skips pending comments, then unmerge restores the survivor', async () => {
    const actor = await seedPrincipal('Admin')
    const voterA = await seedPrincipal('Voter A')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 1,
      commentCount: 1,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 1,
      commentCount: 1,
    })

    await seedVote(canonical, voterA)
    await seedVote(source, voterA)
    await seedComment(canonical, voterA, 'visible on canonical')
    await seedComment(source, voterA, 'pending on source', { moderationState: 'pending' })

    const merged = await mergePost(source, canonical, actor)
    expect(merged.canonicalPost.voteCount).toBe(1)

    const [afterMerge] = await testDb.select().from(posts).where(eq(posts.id, canonical))
    expect(afterMerge.voteCount).toBe(1)
    expect(afterMerge.commentCount).toBe(1)

    const voters = await getPostVoters(canonical)
    expect(voters.map((v) => v.principalId)).toEqual([voterA])

    await unmergePost(source, actor)

    const [afterUnmerge] = await testDb.select().from(posts).where(eq(posts.id, canonical))
    expect(afterUnmerge.voteCount).toBe(1)
    expect(afterUnmerge.commentCount).toBe(1)
    expect(await hasUserVoted(canonical, voterA)).toBe(true)
    expect(await getMergedPosts(canonical)).toEqual([])

    const [sourceAfter] = await testDb.select().from(posts).where(eq(posts.id, source))
    expect(sourceAfter.voteCount).toBe(1)
    expect(sourceAfter.commentCount).toBe(0)
  })

  it('restores the source voteCount on unmerge after the vote was removed via the canonical', async () => {
    const actor = await seedPrincipal('Admin')
    const voter = await seedPrincipal('Voter')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 0,
      commentCount: 0,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 1,
      commentCount: 0,
    })
    await seedVote(source, voter)
    await mergePost(source, canonical, actor)

    const unvote = await voteOnPost(canonical, voter)
    expect(unvote.voted).toBe(false)
    expect(unvote.voteCount).toBe(0)

    await unmergePost(source, actor)

    const [sourceAfter] = await testDb.select().from(posts).where(eq(posts.id, source))
    expect(sourceAfter.voteCount).toBe(0)
  })

  it('applies a vote on a merged source id to the canonical', async () => {
    const actor = await seedPrincipal('Admin')
    const voter = await seedPrincipal('Voter')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 0,
      commentCount: 0,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 0,
      commentCount: 0,
    })
    await mergePost(source, canonical, actor)

    const result = await voteOnPost(source, voter)
    expect(result.voted).toBe(true)
    expect(result.voteCount).toBe(1)

    const [canonicalRow] = await testDb.select().from(posts).where(eq(posts.id, canonical))
    expect(canonicalRow.voteCount).toBe(1)
    expect(await hasUserVoted(canonical, voter)).toBe(true)
  })

  it('pages unique overlapping voters without a short first page', async () => {
    const actor = await seedPrincipal('Admin')
    const voterA = await seedPrincipal('Voter A')
    const voterB = await seedPrincipal('Voter B')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 2,
      commentCount: 0,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 1,
      commentCount: 0,
    })
    const t1 = new Date('2026-01-01T00:00:00.000Z')
    const t2 = new Date('2026-01-02T00:00:00.000Z')
    const t3 = new Date('2026-01-03T00:00:00.000Z')
    await seedVote(canonical, voterA, t1)
    await seedVote(source, voterA, t2)
    await seedVote(canonical, voterB, t3)
    await mergePost(source, canonical, actor)

    // Two unique people, three vote rows. Dedup must happen before the
    // limit so a page of 2 is full and not marked as having more.
    const both = await listPostVoters(canonical, { limit: 2 })
    expect(both.items).toHaveLength(2)
    expect(both.hasMore).toBe(false)

    const page = await listPostVoters(canonical, { limit: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0].principalId).toBe(voterB)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBeTruthy()

    const rest = await listPostVoters(canonical, { limit: 1, cursor: page.nextCursor! })
    expect(rest.items).toHaveLength(1)
    expect(rest.items[0].principalId).toBe(voterA)
  })

  it('reads a source-post subscription on the canonical thread', async () => {
    const actor = await seedPrincipal('Admin')
    const voter = await seedPrincipal('Voter')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 0,
      commentCount: 0,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 1,
      commentCount: 0,
    })
    await seedVote(source, voter)
    await testDb.insert(postSubscriptions).values({
      postId: source,
      principalId: voter,
      reason: 'vote',
      notifyComments: true,
      notifyStatusChanges: true,
    })
    await mergePost(source, canonical, actor)

    const status = await getVoteAndSubscriptionStatus(canonical, voter)
    expect(status.hasVoted).toBe(true)
    expect(status.subscription.subscribed).toBe(true)
    expect(status.subscription.level).toBe('all')
  })

  it('maps a source vote to the canonical in getVotedPostIdsByUserId', async () => {
    const actor = await seedPrincipal('Admin')
    const voter = await seedPrincipal('Voter')
    const [voterRow] = await testDb
      .select({ userId: principal.userId })
      .from(principal)
      .where(eq(principal.id, voter))
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 0,
      commentCount: 0,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 1,
      commentCount: 0,
    })
    await seedVote(source, voter)
    await mergePost(source, canonical, actor)

    const ids = await getVotedPostIdsByUserId(voterRow.userId!)
    expect(ids.has(canonical)).toBe(true)
    expect(ids.has(source)).toBe(true)
  })

  it('lists live source vote rows on merged posts, not the stale stored count', async () => {
    const actor = await seedPrincipal('Admin')
    const voter = await seedPrincipal('Voter')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 0,
      commentCount: 0,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 1,
      commentCount: 0,
    })
    await seedVote(source, voter)
    await mergePost(source, canonical, actor)

    expect((await getMergedPosts(canonical))[0]?.voteCount).toBe(1)

    await voteOnPost(canonical, voter)

    expect((await getMergedPosts(canonical))[0]?.voteCount).toBe(0)
    const [sourceRow] = await testDb.select().from(posts).where(eq(posts.id, source))
    expect(sourceRow.voteCount).toBe(1)
  })

  it('fans out one subscriber when they subscribed on both the source and the canonical', async () => {
    const actor = await seedPrincipal('Admin')
    const voter = await seedPrincipal('Voter', 'voter@example.com')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 0,
      commentCount: 0,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 0,
      commentCount: 0,
    })
    await testDb.insert(postSubscriptions).values([
      {
        postId: canonical,
        principalId: voter,
        reason: 'manual',
        notifyComments: false,
        notifyStatusChanges: true,
      },
      {
        postId: source,
        principalId: voter,
        reason: 'vote',
        notifyComments: true,
        notifyStatusChanges: false,
      },
    ])
    await mergePost(source, canonical, actor)

    const subscribers = await getSubscribersForEvent(canonical, 'comment')
    expect(subscribers.map((s) => s.principalId)).toEqual([voter])
    expect(subscribers[0]?.notifyComments).toBe(true)
    expect(subscribers[0]?.notifyStatusChanges).toBe(true)

    const status = await getSubscriptionStatus(voter, canonical)
    expect(status.subscribed).toBe(true)
    expect(status.level).toBe('all')
  })

  it('reads and unsubscribes a source-only subscription via the canonical', async () => {
    const actor = await seedPrincipal('Admin')
    const voter = await seedPrincipal('Voter', 'voter2@example.com')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 0,
      commentCount: 0,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 0,
      commentCount: 0,
    })
    await testDb.insert(postSubscriptions).values({
      postId: source,
      principalId: voter,
      reason: 'vote',
      notifyComments: true,
      notifyStatusChanges: true,
    })
    await mergePost(source, canonical, actor)

    const status = await getSubscriptionStatus(voter, canonical)
    expect(status.subscribed).toBe(true)
    expect(status.level).toBe('all')

    await unsubscribeFromPost(voter, canonical)

    expect((await getSubscriptionStatus(voter, canonical)).subscribed).toBe(false)
    expect((await getSubscriptionStatus(voter, source)).subscribed).toBe(false)
  })

  it('shows the thread subscription level on the voter list even when the newest vote is on the other post', async () => {
    const actor = await seedPrincipal('Admin')
    const voter = await seedPrincipal('Voter', 'voter3@example.com')
    const boardId = await seedBoard()
    const canonical = await seedPost({
      boardId,
      principalId: actor,
      title: 'Canonical',
      voteCount: 1,
      commentCount: 0,
    })
    const source = await seedPost({
      boardId,
      principalId: actor,
      title: 'Source',
      voteCount: 1,
      commentCount: 0,
    })
    const t1 = new Date('2026-01-01T00:00:00.000Z')
    const t2 = new Date('2026-01-02T00:00:00.000Z')
    await seedVote(canonical, voter, t1)
    await seedVote(source, voter, t2)
    await testDb.insert(postSubscriptions).values({
      postId: canonical,
      principalId: voter,
      reason: 'vote',
      notifyComments: true,
      notifyStatusChanges: true,
    })
    await mergePost(source, canonical, actor)

    const voters = await getPostVoters(canonical)
    expect(voters).toHaveLength(1)
    expect(voters[0]?.subscriptionLevel).toBe('all')
  })
})
