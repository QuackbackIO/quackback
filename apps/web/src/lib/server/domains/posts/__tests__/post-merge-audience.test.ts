/**
 * `getPostMergeInfo` audience guard.
 *
 * The function returns the canonical post's title + board slug for a
 * duplicate. Before this guard, anonymous (or under-privileged) viewers
 * could pass a duplicate id and learn the title + board slug of a
 * canonical that lives on a team-only or segment-restricted board — the
 * function ran no audience check and was used by the `getPostMergeInfoFn`
 * server-fn (with no auth) and `fetchPublicPostDetail` (with portal-only
 * gating).
 *
 * The fix wires an actor through and runs `canViewBoard` on the
 * canonical's audience. Denials return null, matching the "doesn't exist"
 * shape for unauthorized viewers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PrincipalId, SegmentId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'

const mockPostFindFirst = vi.fn()
const mockSelectChain = {
  from: vi.fn().mockReturnThis(),
  innerJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn(),
}

// Base the mock on the REAL module via importOriginal so every named export the
// source-under-test transitively imports (tables, operators, etc.) resolves. The
// `db` export is a lazy Proxy, so importOriginal opens NO database connection. The
// spread satisfies transitive imports while our explicit `db`/operator/table
// overrides below preserve the query-shape assertions this file depends on.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      posts: {
        findFirst: (...args: unknown[]) => mockPostFindFirst(...args),
      },
    },
    select: vi.fn(() => mockSelectChain),
  },
  posts: {
    id: 'posts.id',
    title: 'posts.title',
    boardId: 'posts.boardId',
    deletedAt: 'posts.deletedAt',
    moderationState: 'posts.moderationState',
    principalId: 'posts.principalId',
  },
  boards: {
    id: 'boards.id',
    slug: 'boards.slug',
    access: 'boards.access',
    deletedAt: 'boards.deletedAt',
  },
  eq: vi.fn((col, val) => ({ eq: [col, val] })),
  and: vi.fn((...parts) => ({ and: parts })),
  isNull: vi.fn((col) => ({ isNull: col })),
}))

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    principalId: 'prn_test' as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set<SegmentId>(),
    ...overrides,
  }
}

const DUP_ID = 'post_dup' as PostId
const CANON_ID = 'post_canon' as PostId

beforeEach(() => {
  vi.clearAllMocks()
  mockPostFindFirst.mockResolvedValue({
    canonicalPostId: CANON_ID,
    mergedAt: new Date('2026-01-01'),
  })
})

describe('getPostMergeInfo — audience guard', () => {
  it('returns null when the canonical post sits on a team-only board and the actor is anonymous', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([
      {
        id: CANON_ID,
        title: 'Internal cleanup plan',
        boardSlug: 'team-private',
        boardAccess: {
          view: 'team',
          vote: 'team',
          comment: 'team',
          submit: 'team',
          segments: { view: [], vote: [], comment: [], submit: [] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
        moderationState: 'published',
        principalId: 'prn_author',
      },
    ])
    const { getPostMergeInfo } = await import('../post.merge')
    const result = await getPostMergeInfo(DUP_ID)
    expect(result).toBeNull()
  })

  it('returns null on a segments-audience canonical for an actor not in any allowed segment', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([
      {
        id: CANON_ID,
        title: 'Pro plan idea',
        boardSlug: 'pro-only',
        boardAccess: {
          view: 'segments',
          vote: 'segments',
          comment: 'segments',
          submit: 'segments',
          segments: {
            view: ['seg_pro'],
            vote: ['seg_pro'],
            comment: ['seg_pro'],
            submit: ['seg_pro'],
          },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
        moderationState: 'published',
        principalId: 'prn_author',
      },
    ])
    const { getPostMergeInfo } = await import('../post.merge')
    const result = await getPostMergeInfo(DUP_ID, actor({ role: 'user' }))
    expect(result).toBeNull()
  })

  it('returns the merge info for a team actor regardless of audience', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([
      {
        id: CANON_ID,
        title: 'Internal cleanup plan',
        boardSlug: 'team-private',
        boardAccess: {
          view: 'team',
          vote: 'team',
          comment: 'team',
          submit: 'team',
          segments: { view: [], vote: [], comment: [], submit: [] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
        moderationState: 'published',
        principalId: 'prn_author',
      },
    ])
    const { getPostMergeInfo } = await import('../post.merge')
    const result = await getPostMergeInfo(DUP_ID, actor({ role: 'admin' }))
    expect(result).toMatchObject({
      canonicalPostId: CANON_ID,
      canonicalPostTitle: 'Internal cleanup plan',
      canonicalPostBoardSlug: 'team-private',
    })
  })

  it('returns the merge info for a segments-audience match when the actor is a member', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([
      {
        id: CANON_ID,
        title: 'Pro plan idea',
        boardSlug: 'pro-only',
        boardAccess: {
          view: 'segments',
          vote: 'segments',
          comment: 'segments',
          submit: 'segments',
          segments: {
            view: ['seg_pro'],
            vote: ['seg_pro'],
            comment: ['seg_pro'],
            submit: ['seg_pro'],
          },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
        moderationState: 'published',
        principalId: 'prn_author',
      },
    ])
    const { getPostMergeInfo } = await import('../post.merge')
    const result = await getPostMergeInfo(
      DUP_ID,
      actor({ role: 'user', segmentIds: new Set(['seg_pro' as SegmentId]) })
    )
    expect(result?.canonicalPostId).toBe(CANON_ID)
  })

  it('returns the merge info unconditionally for a public-audience canonical', async () => {
    mockSelectChain.limit.mockResolvedValueOnce([
      {
        id: CANON_ID,
        title: 'Public canon',
        boardSlug: 'public-board',
        boardAccess: {
          view: 'anonymous',
          vote: 'anonymous',
          comment: 'anonymous',
          submit: 'anonymous',
          segments: { view: [], vote: [], comment: [], submit: [] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
        moderationState: 'published',
        principalId: 'prn_author',
      },
    ])
    const { getPostMergeInfo } = await import('../post.merge')
    // anonymous (no actor passed) — the helper defaults to ANONYMOUS_ACTOR.
    const result = await getPostMergeInfo(DUP_ID)
    expect(result?.canonicalPostId).toBe(CANON_ID)
  })

  it('returns null when the duplicate has no canonical', async () => {
    mockPostFindFirst.mockResolvedValueOnce({ canonicalPostId: null, mergedAt: null })
    const { getPostMergeInfo } = await import('../post.merge')
    const result = await getPostMergeInfo(DUP_ID)
    expect(result).toBeNull()
  })

  it('returns null when the canonical is in pending/spam state for a non-author (G13)', async () => {
    // Regression: the original audience gate used canViewBoard only,
    // so a pending or spam canonical on a public-audience board
    // still leaked its title via the merge banner. Now uses
    // canViewPost which combines audience + moderation state.
    mockSelectChain.limit.mockResolvedValueOnce([
      {
        id: CANON_ID,
        title: 'Awaiting approval',
        boardSlug: 'public-board',
        boardAccess: {
          view: 'anonymous',
          vote: 'anonymous',
          comment: 'anonymous',
          submit: 'anonymous',
          segments: { view: [], vote: [], comment: [], submit: [] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
        moderationState: 'pending',
        principalId: 'prn_other_author',
      },
    ])
    const { getPostMergeInfo } = await import('../post.merge')
    const result = await getPostMergeInfo(
      DUP_ID,
      actor({ principalId: 'prn_random_viewer' as PrincipalId })
    )
    expect(result).toBeNull()
  })
})
