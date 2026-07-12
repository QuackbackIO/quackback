/**
 * Tests for post merge service — guard conditions and core logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PrincipalId } from '@quackback/ids'

// --- Mock tracking ---
const mockPostsFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockBoardsFindFirst = vi.fn()
const mockDbUpdate = vi.fn()
const mockDbExecute = vi.fn()
const createActivity = vi.fn()
const scheduleDispatch = vi.fn().mockResolvedValue(undefined)

// The in-transaction re-checks (existingChild, freshCanonical) and the
// claim UPDATE's `.returning()` result are both individually controllable
// per test — the default sequence models the happy path (no existing
// child, canonical not merged elsewhere, claim succeeds); the
// concurrent-merge tests below override one or more of these to reproduce
// the guard rejecting a would-be two-level chain or a lost claim race.
const hoisted = vi.hoisted(() => ({
  mockTxPostsFindFirst: vi.fn(),
  claimedReturning: [{ id: 'post_test_id' }] as Array<{ id: string }>,
}))

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn(() => chain)
  // .where() either resolves directly (legacy callers) OR is followed
  // by .returning() (new mergePost canonicalPostId-pin path). Return a
  // thenable that yields undefined plus exposes .returning() for the
  // round-3 add.
  chain.where = vi.fn(() => ({
    then: (onFulfilled: (v: void) => void) => Promise.resolve().then(onFulfilled),
    returning: () => Promise.resolve(hoisted.claimedReturning),
  }))
  return chain
}

vi.mock('@/lib/server/db', async (importOriginal) => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      query: {
        posts: { findFirst: (...args: unknown[]) => mockPostsFindFirst(...args) },
        principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
        boards: { findFirst: (...args: unknown[]) => mockBoardsFindFirst(...args) },
      },
      update: (..._args: unknown[]) => {
        mockDbUpdate(..._args)
        return createUpdateChain()
      },
      execute: (...args: unknown[]) => mockDbExecute(...args),
      // Transaction wrapper for mergePost / unmergePost — runs the
      // callback synchronously against the same mock surface (the
      // production code only uses tx.update / tx.execute, both of
      // which forward to db here).
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          query: {
            posts: {
              findFirst: (...args: unknown[]) => hoisted.mockTxPostsFindFirst(...args),
            },
          },
          update: (..._args: unknown[]) => {
            mockDbUpdate(..._args)
            return createUpdateChain()
          },
          execute: (...args: unknown[]) => mockDbExecute(...args),
        }),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    sql: realSql,
  }
})

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: (...args: unknown[]) => createActivity(...args),
}))

vi.mock('@/lib/server/events/scheduler', () => ({
  scheduleDispatch: (...args: unknown[]) => scheduleDispatch(...args),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostMerged: vi.fn(),
  dispatchPostUnmerged: vi.fn(),
  buildEventActor: vi.fn((actor) => actor),
}))

vi.mock('@/lib/server/utils', () => ({
  getExecuteRows: vi.fn((result: unknown) => result as unknown[]),
}))

vi.mock('./post.query', () => ({
  getPostWithDetails: vi.fn(),
  getCommentsWithReplies: vi.fn(),
}))

vi.mock('./post.public.utils', () => ({
  hasUserVoted: vi.fn(),
}))

vi.mock('@quackback/ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('@quackback/ids')>()
  return {
    ...original,
    toUuid: vi.fn((id: string) => id),
  }
})

// Import after mocks
const { mergePost, unmergePost } = await import('../post.merge')

const POST_A = 'post_aaa' as PostId
const POST_B = 'post_bbb' as PostId
const ACTOR = 'principal_admin' as PrincipalId

function mockPost(overrides: Record<string, unknown> = {}) {
  return {
    id: POST_A,
    title: 'Test Post',
    voteCount: 5,
    canonicalPostId: null,
    deletedAt: null,
    principalId: 'principal_author',
    boardId: 'board_mock',
    ...overrides,
  }
}

describe('mergePost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: both posts exist and are valid
    mockPostsFindFirst.mockImplementation(() => {
      return Promise.resolve(mockPost())
    })
    mockPrincipalFindFirst.mockResolvedValue({ displayName: 'Author' })
    mockBoardsFindFirst.mockResolvedValue({ id: 'board_mock', slug: 'feedback' })
    // Default: vote count recalculation returns 5
    mockDbExecute.mockResolvedValue([{ unique_voters: 5 }])
    // Default in-transaction re-check sequence: no existing child on the
    // duplicate, canonical not merged elsewhere — i.e. the happy path.
    // `clearAllMocks` clears call history but not a queued `Once` chain
    // from a prior test, so reset explicitly before re-queuing.
    hoisted.mockTxPostsFindFirst.mockReset()
    hoisted.mockTxPostsFindFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ canonicalPostId: null })
    hoisted.claimedReturning = [{ id: 'post_test_id' }]
  })

  it('throws ValidationError on self-merge', async () => {
    await expect(mergePost(POST_A, POST_A, ACTOR)).rejects.toThrow(
      'A post cannot be merged into itself'
    )
  })

  it('throws NotFoundError when duplicate post not found', async () => {
    mockPostsFindFirst
      .mockResolvedValueOnce(null) // duplicate not found
      .mockResolvedValueOnce(mockPost({ id: POST_B })) // canonical found

    await expect(mergePost(POST_A, POST_B, ACTOR)).rejects.toThrow(/not found/)
  })

  it('throws NotFoundError when canonical post not found', async () => {
    mockPostsFindFirst
      .mockResolvedValueOnce(mockPost({ id: POST_A })) // duplicate found
      .mockResolvedValueOnce(null) // canonical not found

    await expect(mergePost(POST_A, POST_B, ACTOR)).rejects.toThrow(/not found/)
  })

  it('throws ConflictError when duplicate is already merged', async () => {
    mockPostsFindFirst
      .mockResolvedValueOnce(mockPost({ id: POST_A, canonicalPostId: 'post_other' }))
      .mockResolvedValueOnce(mockPost({ id: POST_B }))

    await expect(mergePost(POST_A, POST_B, ACTOR)).rejects.toThrow(/already merged/)
  })

  it('throws ValidationError when canonical is itself merged', async () => {
    mockPostsFindFirst
      .mockResolvedValueOnce(mockPost({ id: POST_A }))
      .mockResolvedValueOnce(mockPost({ id: POST_B, canonicalPostId: 'post_other' }))

    await expect(mergePost(POST_A, POST_B, ACTOR)).rejects.toThrow(
      /Cannot merge into a post that is itself merged/
    )
  })

  it('records activity on both posts after successful merge', async () => {
    mockPostsFindFirst
      .mockResolvedValueOnce(mockPost({ id: POST_A, title: 'Duplicate' }))
      .mockResolvedValueOnce(mockPost({ id: POST_B, title: 'Canonical' }))

    await mergePost(POST_A, POST_B, ACTOR)

    expect(createActivity).toHaveBeenCalledTimes(2)
    // First call: activity on canonical post
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: POST_B,
        type: 'post.merged_in',
      })
    )
    // Second call: activity on duplicate post
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: POST_A,
        type: 'post.merged_away',
      })
    )
  })

  it('schedules a merge recheck after merge', async () => {
    mockPostsFindFirst
      .mockResolvedValueOnce(mockPost({ id: POST_A }))
      .mockResolvedValueOnce(mockPost({ id: POST_B }))

    await mergePost(POST_A, POST_B, ACTOR)

    expect(scheduleDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        handler: '__post_merge_recheck__',
        payload: { postId: POST_B },
      })
    )
  })

  it('returns merge result with vote count', async () => {
    mockPostsFindFirst
      .mockResolvedValueOnce(mockPost({ id: POST_A }))
      .mockResolvedValueOnce(mockPost({ id: POST_B }))
    mockDbExecute.mockResolvedValue([{ unique_voters: 8 }])

    const result = await mergePost(POST_A, POST_B, ACTOR)

    expect(result).toEqual({
      canonicalPost: { id: POST_B, voteCount: 8 },
      duplicatePost: { id: POST_A },
    })
  })

  it('dispatches post.merged event with board data', async () => {
    const { dispatchPostMerged } = await import('@/lib/server/events/dispatch')
    mockPostsFindFirst
      .mockResolvedValueOnce(mockPost({ id: POST_A, title: 'Dup', boardId: 'board_a' }))
      .mockResolvedValueOnce(mockPost({ id: POST_B, title: 'Canon', boardId: 'board_b' }))
    mockBoardsFindFirst
      .mockResolvedValueOnce({ slug: 'board-a' })
      .mockResolvedValueOnce({ slug: 'board-b' })

    await mergePost(POST_A, POST_B, ACTOR)

    expect(dispatchPostMerged).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: ACTOR }),
      expect.objectContaining({
        id: POST_A,
        title: 'Dup',
        boardId: 'board_a',
        boardSlug: 'board-a',
      }),
      expect.objectContaining({
        id: POST_B,
        title: 'Canon',
        boardId: 'board_b',
        boardSlug: 'board-b',
      })
    )
  })

  // In-transaction re-checks (post.merge.ts:~126-165): after acquiring the
  // sorted advisory locks, mergePost re-verifies the duplicate isn't itself
  // a canonical-with-children and the canonical wasn't merged elsewhere,
  // then claims the duplicate with a conditional
  // `UPDATE ... WHERE canonicalPostId IS NULL ... RETURNING`. These three
  // guards only matter under a race — the pre-transaction findFirst checks
  // above can't see a concurrent write that lands between the read and the
  // lock. Simulated here by controlling what the second (in-tx) findFirst
  // call and the claim UPDATE's `.returning()` report back.
  describe('concurrent-merge re-checks inside the transaction', () => {
    it('rejects when the duplicate is itself a canonical with existing children (would create a two-level chain)', async () => {
      hoisted.mockTxPostsFindFirst.mockReset()
      // existingChild query finds a row -> duplicatePostId already has a
      // child merged into it, so merging it into another canonical would
      // produce child -> duplicate -> canonical, a two-level chain.
      hoisted.mockTxPostsFindFirst.mockResolvedValueOnce({ id: 'some_child_post_id' })

      await expect(mergePost(POST_A, POST_B, ACTOR)).rejects.toThrow(/cannot itself be merged/)

      // No claim was attempted, no chain was created, no activity/dispatch fired.
      expect(mockDbUpdate).not.toHaveBeenCalled()
      expect(createActivity).not.toHaveBeenCalled()
    })

    it('rejects when the canonical was merged elsewhere between the pre-check and the transaction', async () => {
      hoisted.mockTxPostsFindFirst.mockReset()
      hoisted.mockTxPostsFindFirst
        .mockResolvedValueOnce(undefined) // no existing child on the duplicate
        .mockResolvedValueOnce({ canonicalPostId: 'post_other' }) // canonical now merged elsewhere

      await expect(mergePost(POST_A, POST_B, ACTOR)).rejects.toThrow(/merged elsewhere/)

      expect(mockDbUpdate).not.toHaveBeenCalled()
      expect(createActivity).not.toHaveBeenCalled()
    })

    it('rejects when a concurrent merge already claimed the duplicate (lost the UPDATE race)', async () => {
      // Both pre-checks pass...
      hoisted.mockTxPostsFindFirst.mockReset()
      hoisted.mockTxPostsFindFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ canonicalPostId: null })
      // ...but the conditional UPDATE ... WHERE canonicalPostId IS NULL
      // matched zero rows: another admin's merge already claimed this
      // duplicate for a different canonical in between.
      hoisted.claimedReturning = []

      await expect(mergePost(POST_A, POST_B, ACTOR)).rejects.toThrow(/merged elsewhere/)

      // The vote-count recalculation (and everything after it) never runs —
      // only the two advisory-lock acquisitions happened, no third execute
      // for recalculateCanonicalVoteCount, no activity, no second canonical.
      expect(mockDbExecute).toHaveBeenCalledTimes(2)
      expect(createActivity).not.toHaveBeenCalled()
    })
  })
})

describe('unmergePost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBoardsFindFirst.mockResolvedValue({ id: 'board_mock', slug: 'feedback' })
    mockDbExecute.mockResolvedValue([{ unique_voters: 3 }])
  })

  it('throws NotFoundError when post not found', async () => {
    mockPostsFindFirst.mockResolvedValue(null)

    await expect(unmergePost(POST_A, ACTOR)).rejects.toThrow(/not found/)
  })

  it('throws ValidationError when post is not merged', async () => {
    mockPostsFindFirst.mockResolvedValue(mockPost({ canonicalPostId: null }))

    await expect(unmergePost(POST_A, ACTOR)).rejects.toThrow(/not currently merged/)
  })

  it('records activity on both posts after unmerge', async () => {
    mockPostsFindFirst
      .mockResolvedValueOnce(mockPost({ id: POST_A, canonicalPostId: POST_B, title: 'Dup' }))
      .mockResolvedValueOnce(mockPost({ id: POST_B, title: 'Canon' }))

    await unmergePost(POST_A, ACTOR)

    expect(createActivity).toHaveBeenCalledTimes(2)
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: POST_A,
        type: 'post.unmerged',
      })
    )
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: POST_B,
        type: 'post.unmerged',
      })
    )
  })

  it('returns unmerge result with recalculated vote count', async () => {
    mockPostsFindFirst
      .mockResolvedValueOnce(mockPost({ id: POST_A, canonicalPostId: POST_B }))
      .mockResolvedValueOnce(mockPost({ id: POST_B, title: 'Canon' }))
    mockDbExecute.mockResolvedValue([{ unique_voters: 3 }])

    const result = await unmergePost(POST_A, ACTOR)

    expect(result).toEqual({
      post: { id: POST_A },
      canonicalPost: { id: POST_B, voteCount: 3 },
    })
  })

  it('dispatches post.unmerged event with board data', async () => {
    const { dispatchPostUnmerged } = await import('@/lib/server/events/dispatch')
    mockPostsFindFirst
      .mockResolvedValueOnce(
        mockPost({ id: POST_A, canonicalPostId: POST_B, title: 'Dup', boardId: 'board_a' })
      )
      .mockResolvedValueOnce(mockPost({ id: POST_B, title: 'Canon', boardId: 'board_b' }))
    mockBoardsFindFirst
      .mockResolvedValueOnce({ slug: 'board-a' })
      .mockResolvedValueOnce({ slug: 'board-b' })

    await unmergePost(POST_A, ACTOR)

    expect(dispatchPostUnmerged).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: ACTOR }),
      expect.objectContaining({ id: POST_A, boardId: 'board_a' }),
      expect.objectContaining({ id: POST_B, boardId: 'board_b' })
    )
  })
})
