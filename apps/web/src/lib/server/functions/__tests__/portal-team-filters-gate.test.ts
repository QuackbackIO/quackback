/**
 * Permission gate for the portal's team-only feed filters (owner, segments).
 *
 * The public feed accepts `owner` + `segmentIds` params, but they must only be
 * honoured for callers who hold post.view_private — resolved server-side via the
 * policy seam (resolveActorPermissions), never trusted from the request. For
 * everyone else the params are silently dropped: no error, and the underlying
 * query is called WITHOUT owner/segment conditions so the public payload can
 * never be narrowed/widened by a crafted request.
 *
 * Driven on listPublicPostsFn (the live-feed path). The same gate guards
 * fetchPortalData (SSR path) with identical logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// Portal is always granted here — this suite isolates the team-filter gate.
vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: vi.fn().mockResolvedValue({ granted: true, reason: 'public' }),
}))

// The data layer under assertion.
const mockListPublicPosts = vi.fn()
vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: (...a: unknown[]) => mockListPublicPosts(...a),
  getAllUserVotedPostIds: vi.fn(),
}))

// Auth returns a signed-in principal; the *privilege* is decided purely by the
// mocked resolveActorPermissions below so each test controls one variable.
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: vi.fn().mockResolvedValue({ principal: { role: 'member' } }),
  requireAuth: vi.fn(),
  hasAuthCredentials: vi.fn().mockReturnValue(true),
  policyActorFromAuth: vi.fn().mockResolvedValue({ principalType: 'user', role: 'member' }),
}))

const mockResolveActorPermissions = vi.fn()
vi.mock('@/lib/server/policy/permissions', () => ({
  resolveActorPermissions: (...a: unknown[]) => mockResolveActorPermissions(...a),
}))

// Remaining imports of public-posts.ts — mocked only so the module loads.
vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.types', () => ({
  workspaceAllowsAnonymous: vi.fn().mockReturnValue(true),
}))
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

const LIST_PUBLIC_POSTS = 0
let listPublicPostsHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  mockListPublicPosts.mockResolvedValue({ items: [], hasMore: false, total: 0 })
  if (handlers.length === 0) {
    await import('../public-posts')
  }
  listPublicPostsHandler = handlers[LIST_PUBLIC_POSTS]
})

const OWNER = 'principal_owner_1'
const SEGMENT = 'segment_1'
const INPUT = { sort: 'top' as const, page: 1, limit: 20, owner: OWNER, segmentIds: [SEGMENT] }

describe('listPublicPostsFn — team-only owner/segment filter gate', () => {
  it('drops owner + segmentIds for a caller without post.view_private', async () => {
    // A signed-in end user: no post.view_private.
    mockResolveActorPermissions.mockReturnValue(new Set<string>())

    await listPublicPostsHandler({ data: INPUT })

    expect(mockListPublicPosts).toHaveBeenCalledTimes(1)
    const params = mockListPublicPosts.mock.calls[0][0]
    expect(params.ownerId).toBeUndefined()
    expect(params.segmentIds).toBeUndefined()
  })

  it('applies owner + segmentIds for a post.view_private holder', async () => {
    mockResolveActorPermissions.mockReturnValue(new Set<string>(['post.view_private']))

    await listPublicPostsHandler({ data: INPUT })

    const params = mockListPublicPosts.mock.calls[0][0]
    expect(params.ownerId).toBe(OWNER)
    expect(params.segmentIds).toEqual([SEGMENT])
  })

  it("maps owner:'unassigned' to a null owner match for a privileged caller", async () => {
    mockResolveActorPermissions.mockReturnValue(new Set<string>(['post.view_private']))

    await listPublicPostsHandler({
      data: { sort: 'top', page: 1, limit: 20, owner: 'unassigned' },
    })

    const params = mockListPublicPosts.mock.calls[0][0]
    expect(params.ownerId).toBeNull()
  })

  it("ignores owner:'unassigned' for a non-privileged caller", async () => {
    mockResolveActorPermissions.mockReturnValue(new Set<string>())

    await listPublicPostsHandler({
      data: { sort: 'top', page: 1, limit: 20, owner: 'unassigned' },
    })

    const params = mockListPublicPosts.mock.calls[0][0]
    // undefined (not null) → the owner condition is not applied at all.
    expect(params.ownerId).toBeUndefined()
  })
})
