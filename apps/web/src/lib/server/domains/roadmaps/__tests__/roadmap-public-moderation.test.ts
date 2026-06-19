/**
 * Public roadmap views must not leak non-published posts.
 *
 * `getPublicRoadmapPosts` is called by public/portal endpoints
 * (public-posts.getRoadmapPostsByStatusFn + portal.fetchRoadmap...).
 * The earlier implementation filtered on `deletedAt` only — a team
 * member who linked a pending / spam / archived post to a public
 * roadmap would expose that post's title and vote count to anonymous
 * portal viewers.
 *
 * This test pins the `moderationState = 'published'` filter so the
 * regression can't return.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RoadmapId } from '@quackback/ids'

const mockRoadmapFindFirst = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn((col, val) => ({ kind: 'eq', col, val }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      roadmaps: {
        findFirst: (...args: unknown[]) => mockRoadmapFindFirst(...args),
      },
    },
    select: (...args: unknown[]) => mockSelect(...args),
  },
  eq: (col: unknown, val: unknown) => mockEq(col, val),
  and: vi.fn((...parts: unknown[]) => ({ kind: 'and', parts })),
  isNull: vi.fn((col) => ({ kind: 'isNull', col })),
  inArray: vi.fn((col, vals) => ({ kind: 'inArray', col, vals })),
  asc: vi.fn((col) => ({ kind: 'asc', col })),
  desc: vi.fn((col) => ({ kind: 'desc', col })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  roadmaps: { id: 'roadmaps.id' },
  posts: {
    id: 'posts.id',
    title: 'posts.title',
    voteCount: 'posts.voteCount',
    statusId: 'posts.statusId',
    boardId: 'posts.boardId',
    deletedAt: 'posts.deletedAt',
    moderationState: 'posts.moderationState',
    createdAt: 'posts.createdAt',
    principalId: 'posts.principalId',
    searchVector: 'posts.searchVector',
  },
  postRoadmaps: { roadmapId: 'postRoadmaps.roadmapId', postId: 'postRoadmaps.postId' },
  postTags: { postId: 'postTags.postId', tagId: 'postTags.tagId' },
  boards: { id: 'boards.id', name: 'boards.name', slug: 'boards.slug' },
  userSegments: { principalId: 'userSegments.principalId', segmentId: 'userSegments.segmentId' },
}))

function chainReturning(rows: unknown[]): unknown {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  chain.innerJoin = () => chain
  chain.where = () => chain
  chain.orderBy = () => chain
  chain.limit = () => chain
  chain.offset = () => Promise.resolve(rows)
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  // First select → results, second select → count.
  // The count query now does two innerJoin calls (postRoadmaps→posts→boards)
  // so the count branch needs nested innerJoin chains.
  const countChain = { where: () => Promise.resolve([{ count: 0 }]) }
  mockSelect.mockReturnValueOnce(chainReturning([])).mockReturnValueOnce({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => countChain,
        where: () => Promise.resolve([{ count: 0 }]),
      }),
    }),
  })
  mockRoadmapFindFirst.mockResolvedValue({
    id: 'rm_1' as RoadmapId,
    access: { view: 'anonymous', segments: { view: [] } },
  })
})

describe('getPublicRoadmapPosts — moderation state filter', () => {
  it('adds posts.moderationState === "published" to the WHERE conditions', async () => {
    const { getPublicRoadmapPosts } = await import('../roadmap.query')

    await getPublicRoadmapPosts('rm_1' as RoadmapId, { limit: 20, offset: 0 })

    // Look for an eq() call against posts.moderationState with 'published'.
    const moderationCalls = mockEq.mock.calls.filter(
      ([col, val]) => col === 'posts.moderationState' && val === 'published'
    )
    expect(moderationCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT add the moderation filter on the team-facing getRoadmapPosts (team sees pending)', async () => {
    // Team callers should still see pending/spam posts on the admin
    // roadmap UI so they can act on them — the moderation filter is
    // specifically a public-view gate.
    mockSelect.mockReset()
    // Count query has two innerJoins (postRoadmaps→posts→boards) now that
    // soft-deleted boards are filtered out — mirror the public-side shape.
    const countChain = { where: () => Promise.resolve([{ count: 0 }]) }
    mockSelect.mockReturnValueOnce(chainReturning([])).mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => countChain,
          where: () => Promise.resolve([{ count: 0 }]),
        }),
      }),
    })
    mockEq.mockClear()
    mockRoadmapFindFirst.mockResolvedValue({
      id: 'rm_1' as RoadmapId,
      access: { view: 'team', segments: { view: [] } },
    })

    const { getRoadmapPosts } = await import('../roadmap.query')
    await getRoadmapPosts('rm_1' as RoadmapId, { limit: 20, offset: 0 })

    const moderationCalls = mockEq.mock.calls.filter(
      ([col, val]) => col === 'posts.moderationState' && val === 'published'
    )
    expect(moderationCalls.length).toBe(0)
  })
})
