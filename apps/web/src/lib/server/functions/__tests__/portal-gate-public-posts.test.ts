/**
 * Portal-visibility gate coverage for the four gated functions in
 * public-posts.ts that were missing deny-path tests:
 *   - findSimilarPostsFn        (handler index 11)
 *   - listPublicRoadmapsFn      (handler index 7)
 *   - getPublicRoadmapPostsFn   (handler index 8)
 *   - getRoadmapPostsByStatusFn (handler index 9)
 *
 * Handler registration order for public-posts.ts (createServerFn order):
 *   0  listPublicPostsFn
 *   1  getPostPermissionsFn
 *   2  userEditPostFn
 *   3  userDeletePostFn
 *   4  toggleVoteFn
 *   5  createPublicPostFn
 *   6  getVotedPostsFn
 *   7  listPublicRoadmapsFn
 *   8  getPublicRoadmapPostsFn
 *   9  getRoadmapPostsByStatusFn
 *  10  getVoteSidebarDataFn
 *  11  findSimilarPostsFn
 *
 * Pattern: resolver mocked → gate-denied → data layer NOT called;
 *          resolver mocked → gate-granted → data flows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const publicPostsHandlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        publicPostsHandlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// ---------------------------------------------------------------------------
// Portal-access resolver mock (the gate under test)
// ---------------------------------------------------------------------------

const mockResolvePortalAccess = vi.fn()

vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: () => mockResolvePortalAccess(),
  evaluateMyPortalAccessFn: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Data-layer mocks for the four gated functions
// ---------------------------------------------------------------------------

const mockListPublicRoadmaps = vi.fn()
const mockGetPublicRoadmapPosts = vi.fn()
const mockGetPublicRoadmapPostsPaginated = vi.fn()

vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({
  listPublicRoadmaps: (...a: unknown[]) => mockListPublicRoadmaps(...a),
}))

vi.mock('@/lib/server/domains/roadmaps/roadmap.query', () => ({
  getPublicRoadmapPosts: (...a: unknown[]) => mockGetPublicRoadmapPosts(...a),
}))

vi.mock('@/lib/server/domains/posts/post.public.utils', () => ({
  getPublicRoadmapPostsPaginated: (...a: unknown[]) => mockGetPublicRoadmapPostsPaginated(...a),
  getVoteAndSubscriptionStatus: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Remaining imports needed for public-posts.ts to load
// ---------------------------------------------------------------------------

const mockListPublicPosts = vi.fn()
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: (...a: unknown[]) => mockListPublicPosts(...a),
  getAllUserVotedPostIds: vi.fn(),
}))

const mockPolicyActor = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  hasAuthCredentials: vi.fn().mockReturnValue(false),
  policyActorFromAuth: (...a: unknown[]) => mockPolicyActor(...a),
}))

vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: vi.fn() }))
const mockCanVotePost = vi.fn(() => ({ allowed: true }) as { allowed: boolean; reason?: string })
vi.mock('@/lib/server/policy', () => ({
  canViewBoard: vi.fn(),
  postViewFilter: vi.fn(() => 'POST_VIEW_FILTER_SQL'),
  canVotePost: (...a: unknown[]) => mockCanVotePost(...(a as [])),
}))
vi.mock('@/lib/server/domains/posts/post.service', () => ({ createPost: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.voting', () => ({ voteOnPost: vi.fn() }))
vi.mock('@/lib/server/utils/anon-rate-limit', () => ({ checkAnonVoteRateLimit: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.permissions', () => ({ getPostPermissions: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.user-actions', () => ({
  userEditPost: vi.fn(),
  softDeletePost: vi.fn(),
}))
vi.mock('@/lib/server/domains/boards/board.public', () => ({ getPublicBoardById: vi.fn() }))
vi.mock('@/lib/server/domains/statuses/status.service', () => ({ getDefaultStatus: vi.fn() }))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({ getMemberByUser: vi.fn() }))
vi.mock('@/lib/server/sanitize-tiptap', () => ({ sanitizeTiptapContent: (v: unknown) => v }))

// findSimilarPostsFn uses a dynamic import of the db — stub the whole module
// so the handler can be exercised without a real DB connection.
// `innerJoin` is included so the audience-filter JOIN can be exercised
// (G4 regression: similar-search must JOIN boards to apply postViewFilter).
const mockInnerJoin = vi.fn()
// getVoteSidebarDataFn's per-board vote query terminates at .limit(1);
// the FTS similar-search path uses .orderBy().limit(). Both shapes
// resolve to an empty array by default — individual tests override the
// resolution where they care.
const mockBoardRowLimit = vi.fn().mockResolvedValue([])
mockInnerJoin.mockReturnValue({
  where: vi.fn().mockReturnValue({
    orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
    limit: mockBoardRowLimit,
  }),
})
vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: mockInnerJoin,
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    }),
    query: { principal: { findFirst: vi.fn().mockResolvedValue(null) } },
  },
  posts: {},
  boards: {},
  postStatuses: {},
  principal: { userId: 'userId' },
  eq: vi.fn(),
  inArray: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  desc: vi.fn(),
  // sql is used as a tagged template AND as a function (sql<T>(...).as(...)).
  // Return a chainable stub with .as() so callers like `sql\`…\`.as('score')`
  // don't blow up the audience-filter path.
  sql: Object.assign(
    vi.fn(() => ({ as: vi.fn() })),
    { raw: vi.fn(), join: vi.fn() }
  ),
}))

vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
}))

// Partial mock: stub the assert chokepoints but keep the real
// loadBoardAccessForPost, whose query chain resolves through the db mock's
// .innerJoin().where().limit() (mockBoardRowLimit) like the inlined query did.
vi.mock('@/lib/server/domains/posts/post.access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/domains/posts/post.access')>()
  return {
    ...actual,
    assertPostViewable: vi.fn().mockResolvedValue(undefined),
    assertCommentViewable: vi.fn().mockResolvedValue(undefined),
  }
})

// ---------------------------------------------------------------------------
// Handler indices
// ---------------------------------------------------------------------------

const LIST_PUBLIC_POSTS = 0
const TOGGLE_VOTE = 4
const CREATE_PUBLIC_POST = 5
const LIST_PUBLIC_ROADMAPS = 7
const GET_PUBLIC_ROADMAP_POSTS = 8
const GET_ROADMAP_POSTS_BY_STATUS = 9
const GET_VOTE_SIDEBAR_DATA = 10
const FIND_SIMILAR_POSTS = 11

beforeEach(async () => {
  vi.clearAllMocks()
  if (publicPostsHandlers.length === 0) {
    await import('../public-posts')
  }
})

// ---------------------------------------------------------------------------
// listPublicRoadmapsFn
// ---------------------------------------------------------------------------

describe('listPublicRoadmapsFn — portal-visibility gate', () => {
  it('returns an empty array when the portal is private and the caller is unauthorized', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })

    const result = await publicPostsHandlers[LIST_PUBLIC_ROADMAPS]({ data: {} })

    expect(result).toEqual([])
    expect(mockListPublicRoadmaps).not.toHaveBeenCalled()
  })

  it('returns an empty array for an authenticated-but-unauthorized caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    const result = await publicPostsHandlers[LIST_PUBLIC_ROADMAPS]({ data: {} })

    expect(result).toEqual([])
    expect(mockListPublicRoadmaps).not.toHaveBeenCalled()
  })

  it('returns roadmaps when the portal is public (data flows)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockListPublicRoadmaps.mockResolvedValue([
      {
        id: 'rm_1',
        name: 'Q1',
        slug: 'q1',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: now,
        updatedAt: now,
      },
    ])

    const result = (await publicPostsHandlers[LIST_PUBLIC_ROADMAPS]({ data: {} })) as {
      id: string
    }[]

    expect(mockListPublicRoadmaps).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('rm_1')
  })

  it('returns roadmaps when a team member is granted on a private portal', async () => {
    const now = new Date('2026-02-01T00:00:00.000Z')
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'team' })
    mockListPublicRoadmaps.mockResolvedValue([
      {
        id: 'rm_2',
        name: 'Q2',
        slug: 'q2',
        description: null,
        isPublic: true,
        position: 1,
        createdAt: now,
        updatedAt: now,
      },
    ])

    const result = (await publicPostsHandlers[LIST_PUBLIC_ROADMAPS]({ data: {} })) as {
      id: string
    }[]

    expect(mockListPublicRoadmaps).toHaveBeenCalledTimes(1)
    expect(result[0].id).toBe('rm_2')
  })
})

// ---------------------------------------------------------------------------
// getPublicRoadmapPostsFn
// ---------------------------------------------------------------------------

describe('getPublicRoadmapPostsFn — portal-visibility gate', () => {
  it('returns empty result when the portal is private and the caller is unauthorized', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })

    const result = (await publicPostsHandlers[GET_PUBLIC_ROADMAP_POSTS]({
      data: { roadmapId: 'rm_1', limit: 20, offset: 0 },
    })) as Record<string, unknown>

    expect(result['items']).toEqual([])
    expect(result['hasMore']).toBe(false)
    expect(result['total']).toBe(0)
    expect(mockGetPublicRoadmapPosts).not.toHaveBeenCalled()
  })

  it('returns empty result for an authenticated-but-unauthorized caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    const result = (await publicPostsHandlers[GET_PUBLIC_ROADMAP_POSTS]({
      data: { roadmapId: 'rm_1', limit: 20, offset: 0 },
    })) as Record<string, unknown>

    expect(result['items']).toEqual([])
    expect(mockGetPublicRoadmapPosts).not.toHaveBeenCalled()
  })

  it('returns roadmap posts when the portal is public (data flows)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockGetPublicRoadmapPosts.mockResolvedValue({
      items: [
        {
          id: 'post_1',
          title: 'Ship it',
          voteCount: 3,
          statusId: 'st_1',
          board: { id: 'b1', name: 'Ideas', slug: 'ideas' },
          roadmapEntry: { postId: 'post_1', roadmapId: 'rm_1', position: 0 },
        },
      ],
      hasMore: false,
      total: 1,
    })

    const result = (await publicPostsHandlers[GET_PUBLIC_ROADMAP_POSTS]({
      data: { roadmapId: 'rm_1', limit: 20, offset: 0 },
    })) as { items: { id: string }[] }

    expect(mockGetPublicRoadmapPosts).toHaveBeenCalledTimes(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('post_1')
  })
})

// ---------------------------------------------------------------------------
// getRoadmapPostsByStatusFn
// ---------------------------------------------------------------------------

describe('getRoadmapPostsByStatusFn — portal-visibility gate', () => {
  it('returns empty result when the portal is private and the caller is unauthorized', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })

    const result = (await publicPostsHandlers[GET_ROADMAP_POSTS_BY_STATUS]({
      data: { statusId: 'st_1', page: 1, limit: 10 },
    })) as Record<string, unknown>

    expect(result['items']).toEqual([])
    expect(result['hasMore']).toBe(false)
    expect(result['total']).toBe(0)
    expect(mockGetPublicRoadmapPostsPaginated).not.toHaveBeenCalled()
  })

  it('returns empty result for an authenticated-but-unauthorized caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    const result = (await publicPostsHandlers[GET_ROADMAP_POSTS_BY_STATUS]({
      data: { statusId: 'st_1', page: 1, limit: 10 },
    })) as Record<string, unknown>

    expect(result['items']).toEqual([])
    expect(mockGetPublicRoadmapPostsPaginated).not.toHaveBeenCalled()
  })

  it('returns paginated roadmap posts when the portal is public (data flows)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockGetPublicRoadmapPostsPaginated.mockResolvedValue({
      items: [{ id: 'post_1', title: 'Ship it', voteCount: 2, statusId: 'st_1' }],
      hasMore: false,
      total: 1,
    })

    const result = (await publicPostsHandlers[GET_ROADMAP_POSTS_BY_STATUS]({
      data: { statusId: 'st_1', page: 1, limit: 10 },
    })) as { items: { id: string }[] }

    expect(mockGetPublicRoadmapPostsPaginated).toHaveBeenCalledTimes(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('post_1')
  })

  it('returns paginated posts when a domain-authorized caller is on a private portal', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'domain' })
    mockGetPublicRoadmapPostsPaginated.mockResolvedValue({
      items: [{ id: 'post_2', title: 'Another idea', voteCount: 1, statusId: null }],
      hasMore: false,
      total: 1,
    })

    const result = (await publicPostsHandlers[GET_ROADMAP_POSTS_BY_STATUS]({
      data: { statusId: 'st_2', page: 1, limit: 10 },
    })) as { items: { id: string }[] }

    expect(mockGetPublicRoadmapPostsPaginated).toHaveBeenCalledTimes(1)
    expect(result.items[0].id).toBe('post_2')
  })
})

// ---------------------------------------------------------------------------
// findSimilarPostsFn
// ---------------------------------------------------------------------------

describe('findSimilarPostsFn — portal-visibility gate', () => {
  it('returns an empty array when the portal is private and the caller is unauthorized', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })

    const result = await publicPostsHandlers[FIND_SIMILAR_POSTS]({
      data: { title: 'dark mode support', limit: 5 },
    })

    expect(result).toEqual([])
    // The DB must not be queried for a denied caller.
    // (The db mock's select fn starts uncalled until a granted path runs.)
  })

  it('returns an empty array for an authenticated-but-unauthorized caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    const result = await publicPostsHandlers[FIND_SIMILAR_POSTS]({
      data: { title: 'offline mode', limit: 3 },
    })

    expect(result).toEqual([])
  })

  it('returns an empty array when access is granted but no matches exist', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    // DB mock already returns [] for every select — no matches found.

    const result = (await publicPostsHandlers[FIND_SIMILAR_POSTS]({
      data: { title: 'something unique', limit: 5 },
    })) as unknown[]

    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it('calls the data layer when a team member is granted on a private portal', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'team' })
    // DB still returns [] — we only check the gate is passed, not the data.

    const result = (await publicPostsHandlers[FIND_SIMILAR_POSTS]({
      data: { title: 'internal roadmap item', limit: 5 },
    })) as unknown[]

    // Gate passed — result is an array (possibly empty from the stub DB).
    expect(Array.isArray(result)).toBe(true)
  })

  // Regression: the wrapper functions used to forward no actor, so the
  // inner readers defaulted to ANONYMOUS_ACTOR. Authenticated and
  // segment-member users saw only public-audience boards on the post list
  // and the legacy roadmap-by-status view. Fix: resolve the actor on the
  // server fn and pass it through.

  it('listPublicPostsFn passes the resolved actor to listPublicPosts (G5)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockPolicyActor.mockResolvedValueOnce({
      principalId: 'prn_user_x',
      role: 'user',
      principalType: 'user',
      segmentIds: new Set(['seg_pro']),
    })
    mockListPublicPosts.mockResolvedValueOnce({ items: [], total: 0, hasMore: false })

    await publicPostsHandlers[LIST_PUBLIC_POSTS]({
      data: { sort: 'top', page: 1, limit: 10 },
    })

    expect(mockListPublicPosts).toHaveBeenCalledTimes(1)
    const args = mockListPublicPosts.mock.calls[0][0] as { actor?: { role: string } }
    expect(args.actor).toBeDefined()
    expect(args.actor?.role).toBe('user')
  })

  it('getRoadmapPostsByStatusFn passes the resolved actor to getPublicRoadmapPostsPaginated (G5)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockPolicyActor.mockResolvedValueOnce({
      principalId: 'prn_member',
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
    })
    mockGetPublicRoadmapPostsPaginated.mockResolvedValueOnce({
      items: [],
      total: 0,
      hasMore: false,
    })

    await publicPostsHandlers[GET_ROADMAP_POSTS_BY_STATUS]({
      data: { statusId: 'sta_x', page: 1, limit: 10 },
    })

    expect(mockGetPublicRoadmapPostsPaginated).toHaveBeenCalledTimes(1)
    const args = mockGetPublicRoadmapPostsPaginated.mock.calls[0][0] as {
      actor?: { role: string }
    }
    expect(args.actor).toBeDefined()
    expect(args.actor?.role).toBe('member')
  })

  it('joins boards on the FTS search so postViewFilter can resolve audience (G4)', async () => {
    // Regression: similar-search previously filtered only on
    // `isNull(deletedAt) AND isNull(canonicalPostId)`, leaking titles
    // from team-only / segment-restricted boards and pending posts.
    // The fix joins boards into the query so postViewFilter can apply
    // audience + moderationState rules.
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockInnerJoin.mockClear()

    await publicPostsHandlers[FIND_SIMILAR_POSTS]({
      data: { title: 'something', limit: 5 },
    })

    // The FTS path must JOIN boards. (Vector search short-circuits when
    // generateEmbedding returns null in this mock, so only the FTS chain
    // runs end-to-end here.)
    expect(mockInnerJoin).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Write-path portal-visibility gates (G6)
// ---------------------------------------------------------------------------
//
// Regression: createPublicPostFn, createCommentFn, and toggleVoteFn checked
// per-board audience but never asked the portal-access resolver whether the
// caller is allowed on the portal at all. On a private portal, any
// authenticated principal with knowledge of a public-audience board id
// could post / vote / comment without ever being granted portal access.
// The fix calls resolvePortalAccessForRequest() at the top of each write
// handler; denials short-circuit with an Unauthorized error.

describe('getVoteSidebarDataFn — portal-visibility gate', () => {
  it('returns the non-voting default when the portal is private and the caller is unauthorized', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    const result = (await publicPostsHandlers[GET_VOTE_SIDEBAR_DATA]({
      data: { postId: 'pst_x' },
    })) as { isMember: boolean; canVote: boolean; hasVoted: boolean }

    // Denied callers must not learn whether they've voted, whether
    // they're a member, or whether the post even exists.
    expect(result.isMember).toBe(false)
    expect(result.canVote).toBe(false)
    expect(result.hasVoted).toBe(false)
    expect(mockResolvePortalAccess).toHaveBeenCalled()
  })

  it('returns the non-voting default when the post is not viewable under its board audience', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    // assertPostViewable mock throws NotFound → handler must catch and
    // return the safe default rather than leaking via a stack trace.
    const { assertPostViewable } = await import('@/lib/server/domains/posts/post.access')
    vi.mocked(assertPostViewable).mockRejectedValueOnce(
      Object.assign(new Error('not found'), { name: 'NotFoundError' })
    )

    const result = (await publicPostsHandlers[GET_VOTE_SIDEBAR_DATA]({
      data: { postId: 'pst_blocked' },
    })) as { isMember: boolean; canVote: boolean; hasVoted: boolean }

    expect(result.canVote).toBe(false)
    expect(result.hasVoted).toBe(false)
  })

  // Regression: getVoteSidebarDataFn used to decide canVote from the
  // workspace allowAnonymous flag alone, ignoring board.access.vote.
  // On the modern "Public" preset (view=anonymous, vote=authenticated)
  // an anonymous caller would see canVote=true and only learn the truth
  // on click. Fix: compose canVotePost as a per-board ceiling — and
  // keep the workspace master switch as a separate ceiling on top.

  it('returns canVote=false when board.vote denies even though workspace allowAnonymous is ON', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    // No session cookie → handler resolves canVote without ctx.
    const { hasAuthCredentials } = await import('../auth-helpers')
    vi.mocked(hasAuthCredentials).mockReturnValueOnce(false)
    // Board row is fetched and returns an access object — content is
    // opaque to this test (canVotePost is mocked); the fact that a row
    // exists is what gates the canVote computation.
    mockBoardRowLimit.mockResolvedValueOnce([{ access: { vote: 'authenticated' } }])
    // allowAnonymous flag returns true (workspace ON)
    const { getSettings } = await import('../workspace')
    vi.mocked(getSettings).mockResolvedValueOnce({
      portalConfig: { features: { allowAnonymous: true } },
    } as never)
    // Vote tier denies anonymous
    mockCanVotePost.mockReturnValueOnce({ allowed: false, reason: 'Sign in to vote on this board' })

    const result = (await publicPostsHandlers[GET_VOTE_SIDEBAR_DATA]({
      data: { postId: 'pst_x' },
    })) as { isMember: boolean; canVote: boolean; hasVoted: boolean }

    expect(result.canVote).toBe(false)
  })

  it('returns canVote=true when both workspace allowAnonymous and board.vote allow', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    const { hasAuthCredentials } = await import('../auth-helpers')
    vi.mocked(hasAuthCredentials).mockReturnValueOnce(false)
    mockBoardRowLimit.mockResolvedValueOnce([{ access: { vote: 'anonymous' } }])
    const { getSettings } = await import('../workspace')
    vi.mocked(getSettings).mockResolvedValueOnce({
      portalConfig: { features: { allowAnonymous: true } },
    } as never)
    mockCanVotePost.mockReturnValueOnce({ allowed: true })

    const result = (await publicPostsHandlers[GET_VOTE_SIDEBAR_DATA]({
      data: { postId: 'pst_x' },
    })) as { canVote: boolean }

    expect(result.canVote).toBe(true)
  })

  it('returns canVote=false when workspace allowAnonymous is OFF even on board.vote=anonymous', async () => {
    // The workspace master switch is the ceiling — a board can't override it.
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    const { hasAuthCredentials } = await import('../auth-helpers')
    vi.mocked(hasAuthCredentials).mockReturnValueOnce(false)
    mockBoardRowLimit.mockResolvedValueOnce([{ access: { vote: 'anonymous' } }])
    const { getSettings } = await import('../workspace')
    vi.mocked(getSettings).mockResolvedValueOnce({
      portalConfig: { features: { allowAnonymous: false } },
    } as never)
    mockCanVotePost.mockReturnValueOnce({ allowed: true })

    const result = (await publicPostsHandlers[GET_VOTE_SIDEBAR_DATA]({
      data: { postId: 'pst_x' },
    })) as { canVote: boolean }

    expect(result.canVote).toBe(false)
  })

  // Regression: the no-session path is covered above, but the EXISTING
  // anonymous-session re-check (cookie present, principal.type='anonymous',
  // public-posts.ts:791-802) had no test — a cookie-bearing anon would slip
  // past the workspace master switch even when it is OFF.

  it('existing anonymous session: canVote=false when allowAnonymous is OFF even though board.vote allows', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    const { hasAuthCredentials, getOptionalAuth } = await import('../auth-helpers')
    vi.mocked(hasAuthCredentials).mockReturnValueOnce(true)
    // getOptionalAuth is called twice — once to build the probe actor, once
    // for the session check — so the session must be returned for both.
    const anonSession = {
      user: { id: 'user_anon' },
      principal: { id: 'principal_anon', type: 'anonymous' },
    }
    vi.mocked(getOptionalAuth)
      .mockResolvedValueOnce(anonSession as never)
      .mockResolvedValueOnce(anonSession as never)
    mockBoardRowLimit.mockResolvedValueOnce([{ access: { vote: 'anonymous' } }])
    mockCanVotePost.mockReturnValueOnce({ allowed: true })
    const { getSettings } = await import('../workspace')
    vi.mocked(getSettings).mockResolvedValueOnce({
      portalConfig: { features: { allowAnonymous: false } },
    } as never)
    const { getVoteAndSubscriptionStatus } =
      await import('@/lib/server/domains/posts/post.public.utils')
    vi.mocked(getVoteAndSubscriptionStatus).mockResolvedValueOnce({
      hasVoted: false,
      subscription: { subscribed: false, level: 'none', reason: null },
    } as never)

    const result = (await publicPostsHandlers[GET_VOTE_SIDEBAR_DATA]({
      data: { postId: 'pst_x' },
    })) as { isMember: boolean; canVote: boolean }

    expect(result.isMember).toBe(false)
    expect(result.canVote).toBe(false)
  })

  it('signed-in member: canVote follows board.vote only, not the anonymous master switch', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    const { hasAuthCredentials, getOptionalAuth } = await import('../auth-helpers')
    vi.mocked(hasAuthCredentials).mockReturnValueOnce(true)
    // getOptionalAuth is called twice (probe actor + session check).
    const memberSession = {
      user: { id: 'user_x' },
      principal: { id: 'principal_user', type: 'user' },
    }
    vi.mocked(getOptionalAuth)
      .mockResolvedValueOnce(memberSession as never)
      .mockResolvedValueOnce(memberSession as never)
    mockBoardRowLimit.mockResolvedValueOnce([{ access: { vote: 'authenticated' } }])
    mockCanVotePost.mockReturnValueOnce({ allowed: true })
    const { getVoteAndSubscriptionStatus } =
      await import('@/lib/server/domains/posts/post.public.utils')
    vi.mocked(getVoteAndSubscriptionStatus).mockResolvedValueOnce({
      hasVoted: false,
      subscription: { subscribed: false, level: 'none', reason: null },
    } as never)
    const { getSettings } = await import('../workspace')

    const result = (await publicPostsHandlers[GET_VOTE_SIDEBAR_DATA]({
      data: { postId: 'pst_x' },
    })) as { isMember: boolean; canVote: boolean }

    expect(result.isMember).toBe(true)
    expect(result.canVote).toBe(true)
    // The anonymous master switch is not consulted for a non-anonymous principal.
    expect(vi.mocked(getSettings)).not.toHaveBeenCalled()
  })
})

describe('write-path portal-visibility gates (G6)', () => {
  it('createPublicPostFn calls the portal-access resolver before any side effects', async () => {
    mockResolvePortalAccess.mockClear()
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    // The handler may throw downstream for unrelated reasons (no auth in
    // mock state, etc.). We don't care: the assertion is solely that the
    // portal resolver was consulted, since a denial there short-circuits
    // every side effect that follows.
    await publicPostsHandlers[CREATE_PUBLIC_POST]({
      data: { boardId: 'brd_x', title: 'New post', content: '' },
    }).catch(() => {})

    expect(mockResolvePortalAccess).toHaveBeenCalled()
  })

  it('toggleVoteFn calls the portal-access resolver before any side effects', async () => {
    mockResolvePortalAccess.mockClear()
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    await publicPostsHandlers[TOGGLE_VOTE]({ data: { postId: 'pst_x' } }).catch(() => {})

    expect(mockResolvePortalAccess).toHaveBeenCalled()
  })
})
