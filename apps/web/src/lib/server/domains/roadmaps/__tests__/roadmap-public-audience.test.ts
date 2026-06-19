/**
 * Public roadmap views must not leak posts from boards the actor
 * isn't allowed to see.
 *
 * `getPublicRoadmapPosts` previously filtered on deletedAt +
 * moderationState only. A post on a team-only board linked to a
 * public roadmap surfaced its title + vote count to anonymous
 * portal viewers.
 *
 * The fix: take an `actor` parameter (default ANONYMOUS_ACTOR) and
 * compose `boardViewFilter(actor)` into the WHERE clause. Anonymous
 * callers get the SQL filter built; team callers short-circuit so
 * admins on the team roadmap still see everything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RoadmapId } from '@quackback/ids'

const mockRoadmapFindFirst = vi.fn()
const mockSelect = vi.fn()
const mockBoardViewFilter = vi.fn(() => ({ kind: 'boardViewFilter-sql' }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { roadmaps: { findFirst: (...a: unknown[]) => mockRoadmapFindFirst(...a) } },
    select: (...a: unknown[]) => mockSelect(...a),
  },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
  and: vi.fn((...parts) => ({ kind: 'and', parts })),
  isNull: vi.fn((col) => ({ kind: 'isNull', col })),
  inArray: vi.fn((col, vals) => ({ kind: 'inArray', col, vals })),
  asc: vi.fn(),
  desc: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  roadmaps: { id: 'roadmaps.id' },
  posts: {
    id: 'posts.id',
    boardId: 'posts.boardId',
    deletedAt: 'posts.deletedAt',
    moderationState: 'posts.moderationState',
    statusId: 'posts.statusId',
    voteCount: 'posts.voteCount',
    title: 'posts.title',
    createdAt: 'posts.createdAt',
    principalId: 'posts.principalId',
    searchVector: 'posts.searchVector',
  },
  postRoadmaps: { roadmapId: 'pr.roadmapId', postId: 'pr.postId' },
  postTags: { postId: 'pt.postId', tagId: 'pt.tagId' },
  boards: { id: 'boards.id', name: 'boards.name', slug: 'boards.slug' },
  userSegments: { principalId: 'us.principalId', segmentId: 'us.segmentId' },
}))

// Spy on the policy export so we can assert it was invoked.
vi.mock('@/lib/server/policy', async () => {
  const real = await vi.importActual<typeof import('@/lib/server/policy')>('@/lib/server/policy')
  return { ...real, boardViewFilter: mockBoardViewFilter }
})

function chainReturning(rows: unknown[]) {
  const c: Record<string, unknown> = {}
  c.from = () => c
  c.innerJoin = () => c
  c.where = () => c
  c.orderBy = () => c
  c.limit = () => c
  c.offset = () => Promise.resolve(rows)
  return c
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSelect.mockReturnValueOnce(chainReturning([])).mockReturnValueOnce({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({ where: () => Promise.resolve([{ count: 0 }]) }),
        where: () => Promise.resolve([{ count: 0 }]),
      }),
    }),
  })
  mockRoadmapFindFirst.mockResolvedValue({
    id: 'rm_1' as RoadmapId,
    access: { view: 'anonymous', segments: { view: [] } },
  })
})

describe('getPublicRoadmapPosts — board audience filter', () => {
  it('invokes boardViewFilter with the supplied actor', async () => {
    const { ANONYMOUS_ACTOR } = await import('@/lib/server/policy')
    const { getPublicRoadmapPosts } = await import('../roadmap.query')

    await getPublicRoadmapPosts('rm_1' as RoadmapId, { limit: 20, offset: 0 }, ANONYMOUS_ACTOR)

    expect(mockBoardViewFilter).toHaveBeenCalled()
    const firstCall = mockBoardViewFilter.mock.calls[0] as unknown as [unknown]
    expect(firstCall[0]).toBe(ANONYMOUS_ACTOR)
  })

  it('defaults to ANONYMOUS_ACTOR when no actor passed', async () => {
    const { ANONYMOUS_ACTOR } = await import('@/lib/server/policy')
    const { getPublicRoadmapPosts } = await import('../roadmap.query')

    await getPublicRoadmapPosts('rm_1' as RoadmapId, { limit: 20, offset: 0 })

    expect(mockBoardViewFilter).toHaveBeenCalled()
    const firstCall = mockBoardViewFilter.mock.calls[0] as unknown as [unknown]
    expect(firstCall[0]).toBe(ANONYMOUS_ACTOR)
  })
})
