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
import { boards, eq, postComments, postVotes, posts, principal, user } from '@/lib/server/db'

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
import { getCommentsWithReplies } from '../post.query'
import { hasUserVoted } from '../post.public.utils'
import { getPostVoters } from '../post.voters'
import { DEFAULT_BOARD_ACCESS } from '@/lib/shared/db-types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: posts.id, canonicalPostId: posts.canonicalPostId }).from(posts).limit(0)
  },
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

async function seedVote(postId: PostId, principalId: PrincipalId): Promise<void> {
  await testDb.insert(postVotes).values({ postId, principalId })
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
  })
})
