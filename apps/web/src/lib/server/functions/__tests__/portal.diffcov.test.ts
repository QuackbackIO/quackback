/**
 * Differential-coverage tests for portal.ts's widget feedback content-filter
 * helper postAllowedByWidgetFeedbackFilters, reached via fetchPublicPostDetail.
 * Exercises the status-filter branch and the tag-filter branch (both outcomes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const mockResolvePortalAccess = vi.fn()
vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: () => mockResolvePortalAccess(),
  evaluateMyPortalAccessFn: vi.fn(),
}))

const mockGetWidgetRequestContext = vi.fn()
vi.mock('@/lib/server/widget/context', () => ({
  getWidgetRequestContext: () => mockGetWidgetRequestContext(),
}))

const mockGetPublicPostDetail = vi.fn()
vi.mock('@/lib/server/domains/posts/post.public.detail', () => ({
  getPublicPostDetail: (...a: unknown[]) => mockGetPublicPostDetail(...a),
}))

const mockGetPostMergeInfo = vi.fn()
const mockGetMergedPosts = vi.fn()
vi.mock('@/lib/server/domains/posts/post.merge', () => ({
  getPostMergeInfo: (...a: unknown[]) => mockGetPostMergeInfo(...a),
  getMergedPosts: (...a: unknown[]) => mockGetMergedPosts(...a),
}))

const mockBoardCapabilitiesForActor = vi.fn()
vi.mock('@/lib/server/policy', () => ({
  boardCapabilitiesForActor: (...a: unknown[]) => mockBoardCapabilitiesForActor(...a),
}))

// Other portal.ts deps — present only so the module loads.
vi.mock('@/lib/server/domains/boards/board.public', () => ({
  listPublicBoardsWithStats: vi.fn(),
  getPublicBoardBySlug: vi.fn(),
}))
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: vi.fn(),
  listPublicPostsWithVotesAndAvatars: vi.fn(),
  getVotedPostIdsByUserId: vi.fn(),
}))
vi.mock('@/lib/server/domains/statuses/status.service', () => ({ listPublicStatuses: vi.fn() }))
vi.mock('@/lib/server/domains/tags/tag.service', () => ({ listPublicTags: vi.fn() }))
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getSubscriptionStatus: vi.fn(),
}))
vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({ listPublicRoadmaps: vi.fn() }))
vi.mock('@/lib/server/domains/roadmaps/roadmap.query', () => ({ getPublicRoadmapPosts: vi.fn() }))
vi.mock('@/lib/server/storage/s3', () => ({ getPublicUrlOrNull: vi.fn().mockReturnValue(null) }))

const mockGetOptionalAuth = vi.fn()
const mockPolicyActorFromAuth = vi.fn()
const mockHasAuthCredentials = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: (...a: unknown[]) => mockGetOptionalAuth(...a),
  requireAuth: vi.fn(),
  hasAuthCredentials: (...a: unknown[]) => mockHasAuthCredentials(...a),
  policyActorFromAuth: (...a: unknown[]) => mockPolicyActorFromAuth(...a),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: vi.fn().mockResolvedValue(null) },
      user: { findFirst: vi.fn().mockResolvedValue(null) },
    },
  },
  principal: { id: 'id', userId: 'userId' },
  user: { id: 'id' },
  eq: vi.fn(),
  inArray: vi.fn(),
}))

vi.mock('@/lib/shared/roles', () => ({ isTeamMember: vi.fn().mockReturnValue(false) }))
vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: vi.fn().mockResolvedValue({ portalConfig: { features: { allowAnonymous: true } } }),
}))
vi.mock('@/lib/server/domains/settings/settings.types', () => ({
  workspaceAllowsAnonymous: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/shared/utils', () => ({
  toIsoString: (d: Date | string) => (typeof d === 'string' ? d : (d as Date).toISOString()),
  toIsoStringOrNull: (d: Date | string | null | undefined) =>
    d == null ? null : typeof d === 'string' ? d : (d as Date).toISOString(),
}))

// fetchPublicPostDetail is the 5th registered handler in portal.ts:
//  0 getPrincipalIdForUser
//  1 fetchPortalData
//  2 fetchPublicBoards
//  3 fetchPublicBoardBySlug
//  4 fetchPublicPostDetail
const FETCH_PUBLIC_POST_DETAIL = 4
let fetchPublicPostDetailHandler: AnyHandler

const ACTOR = { principalType: 'user', principalId: 'principal_1', role: 'user' }

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post_1',
    title: 'A post',
    contentJson: { type: 'doc' },
    statusId: 'status_open',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    comments: [],
    boardAccess: { tier: 'public' },
    board: { id: 'board_1', slug: 'roadmap' },
    tags: [{ id: 'tag_1', slug: 'bug' }],
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../portal')
  }
  fetchPublicPostDetailHandler = handlersByIndex[FETCH_PUBLIC_POST_DETAIL]
  mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
  mockHasAuthCredentials.mockReturnValue(true)
  mockGetOptionalAuth.mockResolvedValue({ user: { id: 'user_1' }, principal: ACTOR })
  mockPolicyActorFromAuth.mockResolvedValue(ACTOR)
  mockGetPostMergeInfo.mockResolvedValue(null)
  mockGetMergedPosts.mockResolvedValue([])
  mockBoardCapabilitiesForActor.mockReturnValue({
    canVote: true,
    canComment: true,
    canSubmit: true,
  })
})

describe('postAllowedByWidgetFeedbackFilters (via fetchPublicPostDetail)', () => {
  it('returns the detail unchanged when the widget context has no profile', async () => {
    mockGetPublicPostDetail.mockResolvedValue(makeDetail())
    mockGetWidgetRequestContext.mockResolvedValue({ profileId: undefined, contentFilters: {} })

    const result = (await fetchPublicPostDetailHandler({ data: { postId: 'post_1' } })) as {
      id: string
    } | null

    expect(result?.id).toBe('post_1')
  })

  it('returns null when the post status is excluded by the widget status filter', async () => {
    mockGetPublicPostDetail.mockResolvedValue(makeDetail({ statusId: 'status_open' }))
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { statusIds: ['status_other'] } },
    })

    const result = await fetchPublicPostDetailHandler({ data: { postId: 'post_1' } })

    expect(result).toBeNull()
    // Downstream enrichment must not run for a filtered-out post.
    expect(mockGetPostMergeInfo).not.toHaveBeenCalled()
  })

  it('returns the detail when the status matches the widget status filter', async () => {
    mockGetPublicPostDetail.mockResolvedValue(makeDetail({ statusId: 'status_open' }))
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { statusIds: ['status_open'] } },
    })

    const result = (await fetchPublicPostDetailHandler({ data: { postId: 'post_1' } })) as {
      id: string
    } | null

    expect(result?.id).toBe('post_1')
    expect(mockGetPostMergeInfo).toHaveBeenCalledTimes(1)
  })

  it('returns null when no tag matches the widget tag filter', async () => {
    mockGetPublicPostDetail.mockResolvedValue(makeDetail({ tags: [{ id: 'tag_1', slug: 'bug' }] }))
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { tagIds: ['tag_other'], tagSlugs: ['feature'] } },
    })

    const result = await fetchPublicPostDetailHandler({ data: { postId: 'post_1' } })

    expect(result).toBeNull()
  })

  it('returns the detail when a tag id matches the widget tag filter', async () => {
    mockGetPublicPostDetail.mockResolvedValue(makeDetail({ tags: [{ id: 'tag_1', slug: 'bug' }] }))
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { tagIds: ['tag_1'] } },
    })

    const result = (await fetchPublicPostDetailHandler({ data: { postId: 'post_1' } })) as {
      id: string
    } | null

    expect(result?.id).toBe('post_1')
  })

  it('returns the detail when a tag slug matches and no tag id matches', async () => {
    mockGetPublicPostDetail.mockResolvedValue(makeDetail({ tags: [{ id: 'tag_99', slug: 'bug' }] }))
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { tagSlugs: ['bug'] } },
    })

    const result = (await fetchPublicPostDetailHandler({ data: { postId: 'post_1' } })) as {
      id: string
    } | null

    expect(result?.id).toBe('post_1')
  })

  it('returns null early when getPublicPostDetail finds nothing (filter not consulted)', async () => {
    mockGetPublicPostDetail.mockResolvedValue(null)

    const result = await fetchPublicPostDetailHandler({ data: { postId: 'post_1' } })

    expect(result).toBeNull()
    expect(mockGetWidgetRequestContext).not.toHaveBeenCalled()
  })
})
