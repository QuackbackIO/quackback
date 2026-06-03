/**
 * Tests for the portal-visibility gate applied to public-portal data server
 * functions. Representative coverage on `listPublicPostsFn`:
 *  - private portal + unauthorized caller → empty result (no portal data).
 *  - public portal → data flows unchanged.
 *  - authorized caller (granted on a private portal) → data flows.
 *
 * The resolver itself is unit-tested in resolve-portal-access.test.ts; here it
 * is mocked so each scenario is driven by a single access decision.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

// --- Mock: the portal-access resolver (the gate under test) ---

const mockResolvePortalAccess = vi.fn()

vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: () => mockResolvePortalAccess(),
}))

// --- Mock: the data layer the guarded function calls when access is granted ---

const mockListPublicPosts = vi.fn()

vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: (...args: unknown[]) => mockListPublicPosts(...args),
  getAllUserVotedPostIds: vi.fn(),
}))

// --- Mock: remaining imports of public-posts.ts (only needed so it loads) ---

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: vi.fn(),
  requireAuth: vi.fn(),
  hasAuthCredentials: vi.fn().mockReturnValue(false),
  policyActorFromAuth: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: vi.fn() }))
vi.mock('@/lib/server/policy', () => ({ canViewBoard: vi.fn() }))
vi.mock('@/lib/server/domains/posts/post.public.utils', () => ({
  getPublicRoadmapPostsPaginated: vi.fn(),
  getVoteAndSubscriptionStatus: vi.fn(),
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
vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({ listPublicRoadmaps: vi.fn() }))
vi.mock('@/lib/server/domains/roadmaps/roadmap.query', () => ({ getPublicRoadmapPosts: vi.fn() }))
vi.mock('@/lib/server/sanitize-tiptap', () => ({ sanitizeTiptapContent: (v: unknown) => v }))

// Handler index in public-posts.ts: 0 = listPublicPostsFn.
const LIST_PUBLIC_POSTS = 0
let listPublicPostsHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (publicPostsHandlers.length === 0) {
    await import('../public-posts')
  }
  listPublicPostsHandler = publicPostsHandlers[LIST_PUBLIC_POSTS]
})

// A real-looking posts result from the data layer.
const POSTS_RESULT = {
  items: [
    {
      id: 'post_secret1',
      title: 'Private roadmap idea',
      content: 'sensitive',
      statusId: 'status_1',
      voteCount: 9,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      commentCount: 2,
      authorName: 'Insider',
      principalId: 'principal_1',
      tags: [],
      board: { id: 'board_1', name: 'Roadmap', slug: 'roadmap' },
    },
  ],
  total: -1,
  hasMore: false,
}

const LIST_INPUT = { sort: 'top' as const, page: 1, limit: 20 }

describe('listPublicPostsFn — portal-visibility gate', () => {
  it('returns an empty result when the portal is private and the caller is unauthorized', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as {
      items: unknown[]
      hasMore: boolean
    }

    expect(result.items).toEqual([])
    expect(result.hasMore).toBe(false)
    // The data layer must never be reached for a denied caller.
    expect(mockListPublicPosts).not.toHaveBeenCalled()
  })

  it('returns an empty result for an authenticated-but-unauthorized caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as { items: unknown[] }

    expect(result.items).toEqual([])
    expect(mockListPublicPosts).not.toHaveBeenCalled()
  })

  it('serves posts unchanged when the portal is public', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockListPublicPosts.mockResolvedValue(POSTS_RESULT)

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as {
      items: { id: string; createdAt: string }[]
    }

    expect(mockListPublicPosts).toHaveBeenCalledTimes(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('post_secret1')
    expect(result.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('serves posts when an authorized caller passes the gate on a private portal', async () => {
    // A team member is granted on a private portal — data must flow.
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'team' })
    mockListPublicPosts.mockResolvedValue(POSTS_RESULT)

    const result = (await listPublicPostsHandler({ data: LIST_INPUT })) as { items: unknown[] }

    expect(mockListPublicPosts).toHaveBeenCalledTimes(1)
    expect(result.items).toHaveLength(1)
  })
})
