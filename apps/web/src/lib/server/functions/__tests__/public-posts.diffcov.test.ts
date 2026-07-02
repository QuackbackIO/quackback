/**
 * Differential-coverage tests for the widget feedback content-filter helpers in
 * public-posts.ts: postAllowedByWidgetFeedbackFilters (status + tag branches,
 * reached via listPublicPostsFn) and boardAllowedByWidgetFeedbackFilters
 * (reached via createPublicPostFn).
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
}))

const mockGetWidgetRequestContext = vi.fn()
vi.mock('@/lib/server/widget/context', () => ({
  getWidgetRequestContext: () => mockGetWidgetRequestContext(),
}))

const mockListPublicPosts = vi.fn()
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: (...args: unknown[]) => mockListPublicPosts(...args),
  getAllUserVotedPostIds: vi.fn(),
}))

const mockGetPublicBoardById = vi.fn()
vi.mock('@/lib/server/domains/boards/board.public', () => ({
  getPublicBoardById: (...args: unknown[]) => mockGetPublicBoardById(...args),
}))

const mockCreatePost = vi.fn()
vi.mock('@/lib/server/domains/posts/post.service', () => ({
  createPost: (...args: unknown[]) => mockCreatePost(...args),
}))

const mockGetMemberByUser = vi.fn()
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  getMemberByUser: (...args: unknown[]) => mockGetMemberByUser(...args),
}))

const mockGetDefaultStatus = vi.fn()
vi.mock('@/lib/server/domains/statuses/status.service', () => ({
  getDefaultStatus: (...args: unknown[]) => mockGetDefaultStatus(...args),
}))

const mockGetSettings = vi.fn()
vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: () => mockGetSettings() }))

const mockWorkspaceAllowsAnonymous = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.types', () => ({
  workspaceAllowsAnonymous: (...args: unknown[]) => mockWorkspaceAllowsAnonymous(...args),
}))

const mockGetOptionalAuth = vi.fn()
const mockPolicyActorFromAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: (...args: unknown[]) => mockGetOptionalAuth(...args),
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  hasAuthCredentials: vi.fn().mockReturnValue(false),
  policyActorFromAuth: (...args: unknown[]) => mockPolicyActorFromAuth(...args),
}))
const mockRequireAuth = vi.fn()

// Remaining imports of public-posts.ts (needed only so the module loads).
vi.mock('@/lib/server/policy', () => ({ canViewBoard: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.public.utils', () => ({
  getPublicRoadmapPostsPaginated: vi.fn(),
  getVoteAndSubscriptionStatus: vi.fn(),
}))
vi.mock('@/lib/server/domains/posts/post.voting', () => ({ voteOnPost: vi.fn() }))
vi.mock('@/lib/server/utils/anon-rate-limit', () => ({ checkAnonVoteRateLimit: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.permissions', () => ({ getPostPermissions: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.user-actions', () => ({
  userEditPost: vi.fn(),
  softDeletePost: vi.fn(),
}))
vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({ listPublicRoadmaps: vi.fn() }))
vi.mock('@/lib/server/domains/roadmaps/roadmap.query', () => ({ getPublicRoadmapPosts: vi.fn() }))
vi.mock('@/lib/server/sanitize-tiptap', () => ({ sanitizeTiptapContent: (v: unknown) => v }))

// Handler indices in public-posts.ts: 0 listPublicPostsFn, ... createPublicPostFn is 5th.
//  0 listPublicPostsFn
//  1 getPostPermissionsFn
//  2 userEditPostFn
//  3 userDeletePostFn
//  4 toggleVoteFn
//  5 createPublicPostFn
const LIST_PUBLIC_POSTS = 0
const CREATE_PUBLIC_POST = 5
let listPublicPostsHandler: AnyHandler
let createPublicPostHandler: AnyHandler

const ACTOR = { principalType: 'user', principalId: 'principal_1', role: 'user' }

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlersByIndex.length === 0) {
    await import('../public-posts')
  }
  listPublicPostsHandler = handlersByIndex[LIST_PUBLIC_POSTS]
  createPublicPostHandler = handlersByIndex[CREATE_PUBLIC_POST]
  mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
  mockGetOptionalAuth.mockResolvedValue({ user: { id: 'user_1' }, principal: ACTOR })
  mockPolicyActorFromAuth.mockResolvedValue(ACTOR)
})

const LIST_INPUT = { sort: 'top' as const, page: 1, limit: 20 }

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post_1',
    title: 'A post',
    content: 'body',
    statusId: 'status_open',
    voteCount: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    commentCount: 0,
    authorName: 'Alice',
    principalId: 'principal_1',
    tags: [{ id: 'tag_1', slug: 'bug' }],
    board: { id: 'board_1', slug: 'roadmap' },
    ...overrides,
  }
}

describe('postAllowedByWidgetFeedbackFilters (via listPublicPostsFn)', () => {
  it('returns all posts when the widget context has no profile', async () => {
    mockGetWidgetRequestContext.mockResolvedValue({ profileId: undefined, contentFilters: {} })
    mockListPublicPosts.mockResolvedValue({ items: [makePost()], hasMore: false, total: 1 })

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as { items: unknown[] }

    expect(result.items).toHaveLength(1)
  })

  it('filters out a post whose status is not in the allowed status filter', async () => {
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { statusIds: ['status_other'] } },
    })
    mockListPublicPosts.mockResolvedValue({
      items: [makePost({ statusId: 'status_open' })],
      hasMore: false,
      total: 1,
    })

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as { items: unknown[] }

    expect(result.items).toHaveLength(0)
  })

  it('keeps a post whose status IS in the allowed status filter', async () => {
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { statusIds: ['status_open'] } },
    })
    mockListPublicPosts.mockResolvedValue({
      items: [makePost({ statusId: 'status_open' })],
      hasMore: false,
      total: 1,
    })

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as { items: unknown[] }

    expect(result.items).toHaveLength(1)
  })

  it('filters out a post lacking a status when a status filter is set', async () => {
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { statusIds: ['status_open'] } },
    })
    mockListPublicPosts.mockResolvedValue({
      items: [makePost({ statusId: null })],
      hasMore: false,
      total: 1,
    })

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as { items: unknown[] }

    expect(result.items).toHaveLength(0)
  })

  it('filters out a post that matches no allowed tag (by id or slug)', async () => {
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { tagIds: ['tag_other'], tagSlugs: ['feature'] } },
    })
    mockListPublicPosts.mockResolvedValue({
      items: [makePost({ tags: [{ id: 'tag_1', slug: 'bug' }] })],
      hasMore: false,
      total: 1,
    })

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as { items: unknown[] }

    expect(result.items).toHaveLength(0)
  })

  it('keeps a post matching an allowed tag id', async () => {
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { tagIds: ['tag_1'] } },
    })
    mockListPublicPosts.mockResolvedValue({
      items: [makePost({ tags: [{ id: 'tag_1', slug: 'bug' }] })],
      hasMore: false,
      total: 1,
    })

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as { items: unknown[] }

    expect(result.items).toHaveLength(1)
  })

  it('keeps a post matching an allowed tag slug when no tag id matches', async () => {
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { tagSlugs: ['bug'] } },
    })
    mockListPublicPosts.mockResolvedValue({
      items: [makePost({ tags: [{ id: 'tag_99', slug: 'bug' }] })],
      hasMore: false,
      total: 1,
    })

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as { items: unknown[] }

    expect(result.items).toHaveLength(1)
  })
})

describe('boardAllowedByWidgetFeedbackFilters (via createPublicPostFn)', () => {
  const CREATE_INPUT = { boardId: 'board_1', title: 'New idea', content: 'hi' }

  beforeEach(() => {
    mockRequireAuth.mockResolvedValue({
      user: { id: 'user_1', name: 'Alice', email: 'a@x.com' },
      principal: { id: 'principal_1', role: 'user', type: 'user' },
    })
    mockGetMemberByUser.mockResolvedValue({ id: 'principal_1' })
    mockGetDefaultStatus.mockResolvedValue({ id: 'status_open' })
    mockGetSettings.mockResolvedValue({ portalConfig: {} })
    mockWorkspaceAllowsAnonymous.mockReturnValue(true)
  })

  it('throws when the board is not allowed by the widget board filter', async () => {
    mockGetPublicBoardById.mockResolvedValue({ id: 'board_1', name: 'Roadmap', slug: 'roadmap' })
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { boardIds: ['board_other'], boardSlugs: ['other'] } },
    })

    await expect(createPublicPostHandler({ data: CREATE_INPUT })).rejects.toThrow(
      'Board is not available in this widget'
    )
    expect(mockCreatePost).not.toHaveBeenCalled()
  })

  it('creates the post when the board is allowed by id', async () => {
    mockGetPublicBoardById.mockResolvedValue({ id: 'board_1', name: 'Roadmap', slug: 'roadmap' })
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: { boardIds: ['board_1'] } },
    })
    mockCreatePost.mockResolvedValue({
      id: 'post_new',
      title: 'New idea',
      content: 'hi',
      statusId: 'status_open',
      voteCount: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const result = (await createPublicPostHandler({ data: CREATE_INPUT })) as { id: string }

    expect(result.id).toBe('post_new')
    expect(mockCreatePost).toHaveBeenCalledTimes(1)
  })

  it('creates the post when the widget profile has no board filter (returns true early)', async () => {
    mockGetPublicBoardById.mockResolvedValue({ id: 'board_1', name: 'Roadmap', slug: 'roadmap' })
    mockGetWidgetRequestContext.mockResolvedValue({
      profileId: 'wp_1',
      contentFilters: { feedback: {} },
    })
    mockCreatePost.mockResolvedValue({
      id: 'post_new2',
      title: 'New idea',
      content: 'hi',
      statusId: 'status_open',
      voteCount: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const result = (await createPublicPostHandler({ data: CREATE_INPUT })) as { id: string }

    expect(result.id).toBe('post_new2')
  })

  it('creates the post when there is no widget profile at all (returns true early)', async () => {
    mockGetPublicBoardById.mockResolvedValue({ id: 'board_1', name: 'Roadmap', slug: 'roadmap' })
    mockGetWidgetRequestContext.mockResolvedValue({ profileId: undefined, contentFilters: {} })
    mockCreatePost.mockResolvedValue({
      id: 'post_new3',
      title: 'New idea',
      content: 'hi',
      statusId: 'status_open',
      voteCount: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const result = (await createPublicPostHandler({ data: CREATE_INPUT })) as { id: string }

    expect(result.id).toBe('post_new3')
  })
})
