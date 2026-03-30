import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@featurepool/ids'

// --- Mock: capture handlers registered via createServerFn ---

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const publicPostsHandlers: AnyHandler[] = []
const commentsHandlers: AnyHandler[] = []

// Track which module is being imported to route handlers correctly
let currentHandlerTarget: AnyHandler[] = publicPostsHandlers

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        currentHandlerTarget.push(fn)
        return chain
      },
    }
    return chain
  },
}))

// --- Mock: auth helpers ---

const mockRequireAuth = vi.fn()

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  getOptionalAuth: vi.fn(),
  hasAuthCredentials: vi.fn().mockReturnValue(false),
  hasSessionCookie: vi.fn().mockReturnValue(false),
}))

// --- Mock: settings service (dynamic import target for toggleVoteFn and createCommentFn) ---

const mockGetPortalConfig = vi.fn()

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: () => mockGetPortalConfig(),
}))

// --- Mock: dependencies for toggleVoteFn ---

const mockVoteOnPost = vi.fn()
const mockCheckAnonVoteRateLimit = vi.fn().mockResolvedValue(true)

vi.mock('@/lib/server/domains/posts/post.voting', () => ({
  voteOnPost: (...args: unknown[]) => mockVoteOnPost(...args),
}))

vi.mock('@/lib/server/utils/anon-rate-limit', () => ({
  checkAnonVoteRateLimit: (...args: unknown[]) => mockCheckAnonVoteRateLimit(...args),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ 'x-forwarded-for': '1.2.3.4' }),
}))

// --- Mock: dependencies for createPublicPostFn ---

const mockGetPublicBoardById = vi.fn()
const mockGetMemberByUser = vi.fn()
const mockGetDefaultStatus = vi.fn()
const mockGetSettings = vi.fn()
const mockCreatePost = vi.fn()

vi.mock('@/lib/server/domains/boards/board.public', () => ({
  getPublicBoardById: (...args: unknown[]) => mockGetPublicBoardById(...args),
}))

vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  getMemberByUser: (...args: unknown[]) => mockGetMemberByUser(...args),
}))

vi.mock('@/lib/server/domains/statuses/status.service', () => ({
  getDefaultStatus: () => mockGetDefaultStatus(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  getSettings: () => mockGetSettings(),
}))

vi.mock('@/lib/server/domains/posts/post.service', () => ({
  createPost: (...args: unknown[]) => mockCreatePost(...args),
}))

vi.mock('@/lib/server/sanitize-tiptap', () => ({
  sanitizeTiptapContent: (v: unknown) => v,
}))

vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: vi.fn(),
  getAllUserVotedPostIds: vi.fn(),
  getPublicRoadmapPostsPaginated: vi.fn(),
  getVoteAndSubscriptionStatus: vi.fn(),
}))

vi.mock('@/lib/server/domains/posts/post.permissions', () => ({
  getPostPermissions: vi.fn(),
}))

vi.mock('@/lib/server/domains/posts/post.user-actions', () => ({
  userEditPost: vi.fn(),
  softDeletePost: vi.fn(),
}))

vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({
  listPublicRoadmaps: vi.fn(),
  getPublicRoadmapPosts: vi.fn(),
}))

// --- Mock: dependencies for createCommentFn ---

const mockCreateComment = vi.fn()

vi.mock('@/lib/server/domains/comments/comment.service', () => ({
  createComment: (...args: unknown[]) => mockCreateComment(...args),
  deleteComment: vi.fn(),
  updateComment: vi.fn(),
}))

vi.mock('@/lib/server/domains/comments/comment.reactions', () => ({
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
}))

vi.mock('@/lib/server/domains/comments/comment.permissions', () => ({
  canDeleteComment: vi.fn(),
  canEditComment: vi.fn(),
  softDeleteComment: vi.fn(),
  userEditComment: vi.fn(),
}))

vi.mock('@/lib/server/domains/comments/comment.pin', () => ({
  canPinComment: vi.fn(),
  pinComment: vi.fn(),
  restoreComment: vi.fn(),
  unpinComment: vi.fn(),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

vi.mock('@/lib/shared/roles', () => ({
  isTeamMember: vi.fn(),
}))

// --- Handler indices ---
// public-posts.ts: 0=listPublicPosts, 1=getPostPermissions, 2=userEditPost,
//   3=userDeletePost, 4=toggleVote, 5=createPublicPost, ...
const TOGGLE_VOTE = 4
const CREATE_PUBLIC_POST = 5

// comments.ts: 0=createComment, ...
const CREATE_COMMENT = 0

let toggleVoteHandler: AnyHandler
let createPublicPostHandler: AnyHandler
let createCommentHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  mockCheckAnonVoteRateLimit.mockResolvedValue(true)

  if (publicPostsHandlers.length === 0) {
    currentHandlerTarget = publicPostsHandlers
    await import('../public-posts')
  }
  if (commentsHandlers.length === 0) {
    currentHandlerTarget = commentsHandlers
    await import('../comments')
  }

  toggleVoteHandler = publicPostsHandlers[TOGGLE_VOTE]
  createPublicPostHandler = publicPostsHandlers[CREATE_PUBLIC_POST]
  createCommentHandler = commentsHandlers[CREATE_COMMENT]
})

// --- Shared fixtures ---

const ANON_PRINCIPAL = {
  id: 'principal_anon123' as PrincipalId,
  type: 'anonymous' as const,
  role: 'user' as const,
}

const ANON_AUTH = {
  principal: ANON_PRINCIPAL,
  user: { id: 'user_anon123', email: 'anon@anon.featurepool.io', name: null, image: null },
}

const USER_PRINCIPAL = {
  id: 'principal_user456' as PrincipalId,
  type: 'user' as const,
  role: 'user' as const,
}

const USER_AUTH = {
  principal: USER_PRINCIPAL,
  user: { id: 'user_456', email: 'test@example.com', name: 'Test User', image: null },
}

// ============================================
// toggleVoteFn — anonymous voting feature flag
// ============================================

describe('toggleVoteFn anonymous feature flag', () => {
  it('allows anonymous vote when anonymousVoting is enabled', async () => {
    mockRequireAuth.mockResolvedValue(ANON_AUTH)
    mockGetPortalConfig.mockResolvedValue({
      features: { anonymousVoting: true, anonymousPosting: false, anonymousCommenting: false },
    })
    mockVoteOnPost.mockResolvedValue({ voted: true, voteCount: 5 })

    const result = await toggleVoteHandler({ data: { postId: 'post_123' } })

    expect(result).toEqual({ voted: true, voteCount: 5 })
    expect(mockVoteOnPost).toHaveBeenCalledWith('post_123', ANON_PRINCIPAL.id)
  })

  it('blocks anonymous vote when anonymousVoting is disabled', async () => {
    mockRequireAuth.mockResolvedValue(ANON_AUTH)
    mockGetPortalConfig.mockResolvedValue({
      features: { anonymousVoting: false, anonymousPosting: false, anonymousCommenting: false },
    })

    await expect(toggleVoteHandler({ data: { postId: 'post_123' } })).rejects.toThrow(
      'Anonymous voting is not enabled'
    )
    expect(mockVoteOnPost).not.toHaveBeenCalled()
  })

  it('allows non-anonymous users to vote regardless of feature flag', async () => {
    mockRequireAuth.mockResolvedValue(USER_AUTH)
    mockVoteOnPost.mockResolvedValue({ voted: true, voteCount: 3 })

    const result = await toggleVoteHandler({ data: { postId: 'post_123' } })

    expect(result).toEqual({ voted: true, voteCount: 3 })
    expect(mockGetPortalConfig).not.toHaveBeenCalled()
  })
})

// ============================================
// createPublicPostFn — anonymous posting feature flag
// ============================================

describe('createPublicPostFn anonymous feature flag', () => {
  const POST_DATA = {
    boardId: 'board_123',
    title: 'Test Post',
    content: 'Some content',
  }

  const MOCK_BOARD = { id: 'board_123', name: 'General', slug: 'general', isPublic: true }
  const MOCK_STATUS = { id: 'status_123' }
  const MOCK_POST = {
    id: 'post_new',
    title: 'Test Post',
    content: 'Some content',
    statusId: 'status_123',
    voteCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }

  function setupPostMocks(portalConfig: Record<string, unknown>) {
    mockGetPublicBoardById.mockResolvedValue(MOCK_BOARD)
    mockGetMemberByUser.mockResolvedValue(null)
    mockGetDefaultStatus.mockResolvedValue(MOCK_STATUS)
    mockGetSettings.mockResolvedValue({
      id: 'ws_1',
      portalConfig,
    })
    mockCreatePost.mockResolvedValue(MOCK_POST)
  }

  it('allows anonymous post when anonymousPosting is enabled', async () => {
    mockRequireAuth.mockResolvedValue(ANON_AUTH)
    setupPostMocks({ features: { anonymousPosting: true } })

    const result = (await createPublicPostHandler({ data: POST_DATA })) as Record<string, unknown>

    expect(result).toHaveProperty('id', 'post_new')
    expect(mockCreatePost).toHaveBeenCalled()
  })

  it('blocks anonymous post when anonymousPosting is disabled', async () => {
    mockRequireAuth.mockResolvedValue(ANON_AUTH)
    setupPostMocks({ features: { anonymousPosting: false } })

    await expect(createPublicPostHandler({ data: POST_DATA })).rejects.toThrow(
      'Anonymous posting is not enabled'
    )
    expect(mockCreatePost).not.toHaveBeenCalled()
  })

  it('blocks anonymous post when features config is missing', async () => {
    mockRequireAuth.mockResolvedValue(ANON_AUTH)
    setupPostMocks({})

    await expect(createPublicPostHandler({ data: POST_DATA })).rejects.toThrow(
      'Anonymous posting is not enabled'
    )
    expect(mockCreatePost).not.toHaveBeenCalled()
  })

  it('allows non-anonymous users to post regardless of feature flag', async () => {
    mockRequireAuth.mockResolvedValue(USER_AUTH)
    setupPostMocks({ features: { anonymousPosting: false } })
    mockGetMemberByUser.mockResolvedValue({ id: USER_PRINCIPAL.id })

    const result = (await createPublicPostHandler({ data: POST_DATA })) as Record<string, unknown>

    expect(result).toHaveProperty('id', 'post_new')
  })
})

// ============================================
// createCommentFn — anonymous commenting feature flag
// ============================================

describe('createCommentFn anonymous feature flag', () => {
  const COMMENT_DATA = {
    postId: 'post_123',
    content: 'Great idea!',
  }

  it('allows anonymous comment when anonymousCommenting is enabled', async () => {
    mockRequireAuth.mockResolvedValue(ANON_AUTH)
    mockGetPortalConfig.mockResolvedValue({
      features: { anonymousVoting: false, anonymousPosting: false, anonymousCommenting: true },
    })
    mockCreateComment.mockResolvedValue({
      comment: { id: 'comment_new', content: 'Great idea!' },
    })

    const result = await createCommentHandler({ data: COMMENT_DATA })

    expect(result).toHaveProperty('comment')
    expect(mockCreateComment).toHaveBeenCalled()
  })

  it('blocks anonymous comment when anonymousCommenting is disabled', async () => {
    mockRequireAuth.mockResolvedValue(ANON_AUTH)
    mockGetPortalConfig.mockResolvedValue({
      features: { anonymousVoting: false, anonymousPosting: false, anonymousCommenting: false },
    })

    await expect(createCommentHandler({ data: COMMENT_DATA })).rejects.toThrow(
      'Anonymous commenting is not enabled'
    )
    expect(mockCreateComment).not.toHaveBeenCalled()
  })

  it('allows non-anonymous users to comment regardless of feature flag', async () => {
    mockRequireAuth.mockResolvedValue(USER_AUTH)
    mockCreateComment.mockResolvedValue({
      comment: { id: 'comment_new', content: 'Great idea!' },
    })

    const result = await createCommentHandler({ data: COMMENT_DATA })

    expect(result).toHaveProperty('comment')
    expect(mockGetPortalConfig).not.toHaveBeenCalled()
  })
})
