/**
 * Extended portal-visibility gate coverage across data-layer surfaces.
 *
 * The resolver is mocked so each scenario is driven by a single access
 * decision. Covers:
 *   - portal.ts: fetchPortalData, fetchPublicBoards, fetchPublicBoardBySlug,
 *     fetchPublicPostDetail, fetchPublicPosts, fetchPublicStatuses,
 *     fetchPublicTags, fetchPublicRoadmaps, fetchPublicRoadmapPosts.
 *   - changelog.ts: listPublicChangelogsFn, getPublicChangelogFn.
 *   - Public-portal no-regression: public portal → data flows.
 *   - Authorized caller on private portal → data flows.
 *
 * Handler registration order (portal.ts):
 *   0  getPrincipalIdForUser
 *   1  fetchPortalData
 *   2  fetchPublicBoards
 *   3  fetchPublicBoardBySlug
 *   4  fetchPublicPostDetail
 *   5  fetchPublicPosts
 *   6  fetchPublicStatuses
 *   7  fetchPublicTags
 *   8  fetchUserAvatar
 *   9  fetchAvatars
 *  10  fetchSubscriptionStatus
 *  11  fetchPublicRoadmaps
 *  12  fetchPublicRoadmapPosts
 *  13  getCommentsSectionDataFn
 *
 * Handler registration order (changelog.ts):
 *   0  createChangelogFn
 *   1  updateChangelogFn
 *   2  deleteChangelogFn
 *   3  getChangelogFn
 *   4  listChangelogsFn
 *   5  getPublicChangelogFn
 *   6  listPublicChangelogsFn
 *   7  searchShippedPostsFn
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared handler registry
// ---------------------------------------------------------------------------

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByModule = new Map<string, AnyHandler[]>()
let _currentModule = ''

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        const key = _currentModule
        const arr = handlersByModule.get(key) ?? []
        arr.push(fn)
        handlersByModule.set(key, arr)
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
// portal.ts data-layer mocks
// ---------------------------------------------------------------------------

const mockListPublicBoardsWithStats = vi.fn()
const mockListPublicPostsWithVotesAndAvatars = vi.fn()
const mockListPublicStatuses = vi.fn()
const mockListPublicTags = vi.fn()
const mockGetVotedPostIdsByUserId = vi.fn()
const mockGetPublicBoardBySlug = vi.fn()
const mockGetPublicPostDetail = vi.fn()
const mockListPublicPosts = vi.fn()
const mockGetPortalPublicRoadmaps = vi.fn()
const mockGetPortalPublicRoadmapPosts = vi.fn()
const mockGetPostMergeInfo = vi.fn()
const mockGetMergedPosts = vi.fn()

vi.mock('@/lib/server/domains/boards/board.public', () => ({
  listPublicBoardsWithStats: (...a: unknown[]) => mockListPublicBoardsWithStats(...a),
  getPublicBoardBySlug: (...a: unknown[]) => mockGetPublicBoardBySlug(...a),
}))

vi.mock('@/lib/server/domains/posts/post.public', () => ({
  listPublicPosts: (...a: unknown[]) => mockListPublicPosts(...a),
  listPublicPostsWithVotesAndAvatars: (...a: unknown[]) =>
    mockListPublicPostsWithVotesAndAvatars(...a),
  getVotedPostIdsByUserId: (...a: unknown[]) => mockGetVotedPostIdsByUserId(...a),
  getAllUserVotedPostIds: vi.fn(),
}))

vi.mock('@/lib/server/domains/posts/post.public.detail', () => ({
  getPublicPostDetail: (...a: unknown[]) => mockGetPublicPostDetail(...a),
}))

vi.mock('@/lib/server/domains/posts/post.merge', () => ({
  getPostMergeInfo: (...a: unknown[]) => mockGetPostMergeInfo(...a),
  getMergedPosts: (...a: unknown[]) => mockGetMergedPosts(...a),
}))

vi.mock('@/lib/server/domains/statuses/status.service', () => ({
  listPublicStatuses: (...a: unknown[]) => mockListPublicStatuses(...a),
  getDefaultStatus: vi.fn(),
}))

vi.mock('@/lib/server/domains/tags/tag.service', () => ({
  listPublicTags: (...a: unknown[]) => mockListPublicTags(...a),
}))

vi.mock('@/lib/server/domains/roadmaps/roadmap.service', () => ({
  listPublicRoadmaps: (...a: unknown[]) => mockGetPortalPublicRoadmaps(...a),
}))

vi.mock('@/lib/server/domains/roadmaps/roadmap.query', () => ({
  getPublicRoadmapPosts: (...a: unknown[]) => mockGetPortalPublicRoadmapPosts(...a),
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  getSubscriptionStatus: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  hasAuthCredentials: vi.fn().mockReturnValue(false),
  policyActorFromAuth: vi.fn().mockResolvedValue({ type: 'anonymous', role: 'user' }),
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

// ---------------------------------------------------------------------------
// changelog.ts mocks
// ---------------------------------------------------------------------------

const mockListPublicChangelogs = vi.fn()
const mockGetPublicChangelogById = vi.fn()

vi.mock('@/lib/server/domains/changelog/changelog.public', () => ({
  listPublicChangelogs: (...a: unknown[]) => mockListPublicChangelogs(...a),
  getPublicChangelogById: (...a: unknown[]) => mockGetPublicChangelogById(...a),
  publicChangelogConditions: vi.fn().mockReturnValue([]),
}))

vi.mock('@/lib/server/domains/changelog/changelog.service', () => ({
  createChangelog: vi.fn(),
  updateChangelog: vi.fn(),
  deleteChangelog: vi.fn(),
  getChangelogById: vi.fn(),
}))

vi.mock('@/lib/server/domains/changelog/changelog.query', () => ({
  listChangelogs: vi.fn(),
  searchShippedPosts: vi.fn(),
}))

vi.mock('@/lib/shared/schemas/changelog', () => ({
  createChangelogSchema: { parse: (v: unknown) => v },
  updateChangelogSchema: { parse: (v: unknown) => v },
  listChangelogsSchema: { parse: (v: unknown) => v },
  getChangelogSchema: { parse: (v: unknown) => v },
  deleteChangelogSchema: { parse: (v: unknown) => v },
  listPublicChangelogsSchema: { parse: (v: unknown) => v },
}))

vi.mock('@/lib/shared/utils', () => ({
  toIsoString: (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()),
  toIsoStringOrNull: (d: Date | string | null | undefined) =>
    d == null ? null : typeof d === 'string' ? d : d.toISOString(),
  stripHtml: (s: string) => s,
  truncate: (s: string, n: number) => s.slice(0, n),
}))

vi.mock('@/lib/server/sanitize-tiptap', () => ({
  sanitizeTiptapContent: (v: unknown) => v,
}))

vi.mock('@/lib/shared/errors', () => ({
  NotFoundError: class NotFoundError extends Error {
    code: string
    constructor(code: string, message: string) {
      super(message)
      this.name = 'NotFoundError'
      this.code = code
    }
  },
}))

// ---------------------------------------------------------------------------
// Lazy module loader helper
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

async function loadModule(modulePath: string): Promise<AnyHandler[]> {
  const existing = handlersByModule.get(modulePath)
  if (existing && existing.length > 0) return existing

  _currentModule = modulePath
  await import(modulePath)
  _currentModule = ''
  return handlersByModule.get(modulePath) ?? []
}

// Portal handler indices (see file header comment)
const PORTAL = '@/lib/server/functions/portal' as const
const FETCH_PORTAL_DATA = 1
const FETCH_PUBLIC_BOARDS = 2
const FETCH_PUBLIC_BOARD_BY_SLUG = 3
const FETCH_PUBLIC_POST_DETAIL = 4
const FETCH_PUBLIC_POSTS = 5
const FETCH_PUBLIC_STATUSES = 6
const FETCH_PUBLIC_TAGS = 7
const FETCH_PUBLIC_ROADMAPS = 11
const FETCH_PUBLIC_ROADMAP_POSTS = 12

// Changelog handler indices
const CHANGELOG = '@/lib/server/functions/changelog' as const
const GET_PUBLIC_CHANGELOG = 5
const LIST_PUBLIC_CHANGELOGS = 6

// ---------------------------------------------------------------------------
// portal.ts — fetchPortalData
// ---------------------------------------------------------------------------

describe('portal.ts fetchPortalData — portal-visibility gate', () => {
  it('returns empty structure when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PORTAL_DATA]({ data: { sort: 'top' } })) as Record<
      string,
      unknown
    >
    expect(result).toMatchObject({ boards: [], posts: { items: [] }, statuses: [], tags: [] })
    expect(mockListPublicBoardsWithStats).not.toHaveBeenCalled()
  })

  it('serves data when the portal is public', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockListPublicBoardsWithStats.mockResolvedValue([])
    mockListPublicPostsWithVotesAndAvatars.mockResolvedValue({ items: [], hasMore: false })
    mockListPublicStatuses.mockResolvedValue([])
    mockListPublicTags.mockResolvedValue([])
    mockGetVotedPostIdsByUserId.mockResolvedValue(new Set())

    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PORTAL_DATA]({ data: { sort: 'top' } })) as Record<
      string,
      unknown
    >
    expect(result).toMatchObject({ boards: [], statuses: [], tags: [] })
    expect(mockListPublicBoardsWithStats).toHaveBeenCalledTimes(1)
  })

  it('serves data when an authorized caller accesses a private portal', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'team' })
    mockListPublicBoardsWithStats.mockResolvedValue([])
    mockListPublicPostsWithVotesAndAvatars.mockResolvedValue({ items: [], hasMore: false })
    mockListPublicStatuses.mockResolvedValue([])
    mockListPublicTags.mockResolvedValue([])
    mockGetVotedPostIdsByUserId.mockResolvedValue(new Set())

    const h = await loadModule(PORTAL)
    await h[FETCH_PORTAL_DATA]({ data: { sort: 'top' } })
    expect(mockListPublicBoardsWithStats).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// portal.ts — fetchPublicBoards
// ---------------------------------------------------------------------------

describe('portal.ts fetchPublicBoards — portal-visibility gate', () => {
  it('returns empty array when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })
    const h = await loadModule(PORTAL)
    const result = await h[FETCH_PUBLIC_BOARDS]({ data: {} })
    expect(result).toEqual([])
    expect(mockListPublicBoardsWithStats).not.toHaveBeenCalled()
  })

  it('returns boards when the portal is public', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockListPublicBoardsWithStats.mockResolvedValue([
      { id: 'board_1', name: 'Ideas', settings: {} },
    ])
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_BOARDS]({ data: {} })) as { id: string }[]
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('board_1')
  })

  it('returns boards when domain-authorized caller accesses a private portal', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'domain' })
    mockListPublicBoardsWithStats.mockResolvedValue([
      { id: 'board_1', name: 'Ideas', settings: null },
    ])
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_BOARDS]({ data: {} })) as { id: string }[]
    expect(mockListPublicBoardsWithStats).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// portal.ts — fetchPublicBoardBySlug
// ---------------------------------------------------------------------------

describe('portal.ts fetchPublicBoardBySlug — portal-visibility gate', () => {
  it('returns null when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })
    const h = await loadModule(PORTAL)
    const result = await h[FETCH_PUBLIC_BOARD_BY_SLUG]({ data: { slug: 'ideas' } })
    expect(result).toBeNull()
    expect(mockGetPublicBoardBySlug).not.toHaveBeenCalled()
  })

  it('returns the board when access is granted', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'domain' })
    mockGetPublicBoardBySlug.mockResolvedValue({ id: 'board_1', name: 'Ideas', settings: null })
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_BOARD_BY_SLUG]({ data: { slug: 'ideas' } })) as {
      id: string
    } | null
    expect(result?.id).toBe('board_1')
  })
})

// ---------------------------------------------------------------------------
// portal.ts — fetchPublicPostDetail
// ---------------------------------------------------------------------------

describe('portal.ts fetchPublicPostDetail — portal-visibility gate', () => {
  it('returns null when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })
    const h = await loadModule(PORTAL)
    const result = await h[FETCH_PUBLIC_POST_DETAIL]({ data: { postId: 'post_1' } })
    expect(result).toBeNull()
    expect(mockGetPublicPostDetail).not.toHaveBeenCalled()
  })

  it('returns post detail when access is granted (public portal)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockGetPublicPostDetail.mockResolvedValue({
      id: 'post_1',
      title: 'Hello',
      content: 'body',
      contentJson: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      comments: [],
      statusId: null,
      voteCount: 0,
      boardId: 'board_1',
    })
    mockGetPostMergeInfo.mockResolvedValue(null)
    mockGetMergedPosts.mockResolvedValue([])
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_POST_DETAIL]({ data: { postId: 'post_1' } })) as {
      id: string
    } | null
    expect(result?.id).toBe('post_1')
  })
})

// ---------------------------------------------------------------------------
// portal.ts — fetchPublicPosts
// ---------------------------------------------------------------------------

describe('portal.ts fetchPublicPosts — portal-visibility gate', () => {
  it('returns empty result when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_POSTS]({ data: { sort: 'top' } })) as {
      items: unknown[]
    }
    expect(result.items).toEqual([])
    expect(mockListPublicPosts).not.toHaveBeenCalled()
  })

  it('serves posts when the portal is public', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockListPublicPosts.mockResolvedValue({
      items: [
        {
          id: 'post_1',
          title: 'Idea',
          content: '',
          statusId: null,
          voteCount: 1,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          commentCount: 0,
          authorName: 'Alice',
          principalId: 'p1',
          tags: [],
          board: { id: 'b1', name: 'Ideas', slug: 'ideas' },
        },
      ],
      hasMore: false,
      total: 1,
    })
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_POSTS]({ data: { sort: 'top' } })) as {
      items: { id: string }[]
    }
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('post_1')
  })
})

// ---------------------------------------------------------------------------
// portal.ts — fetchPublicStatuses
// ---------------------------------------------------------------------------

describe('portal.ts fetchPublicStatuses — portal-visibility gate', () => {
  it('returns empty array when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })
    const h = await loadModule(PORTAL)
    const result = await h[FETCH_PUBLIC_STATUSES]({ data: {} })
    expect(result).toEqual([])
    expect(mockListPublicStatuses).not.toHaveBeenCalled()
  })

  it('returns statuses when the portal is public', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockListPublicStatuses.mockResolvedValue([{ id: 'st_1', name: 'Open' }])
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_STATUSES]({ data: {} })) as { id: string }[]
    expect(result).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// portal.ts — fetchPublicTags
// ---------------------------------------------------------------------------

describe('portal.ts fetchPublicTags — portal-visibility gate', () => {
  it('returns empty array when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })
    const h = await loadModule(PORTAL)
    const result = await h[FETCH_PUBLIC_TAGS]({ data: {} })
    expect(result).toEqual([])
    expect(mockListPublicTags).not.toHaveBeenCalled()
  })

  it('returns tags when access is granted (domain-match on private portal)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'domain' })
    mockListPublicTags.mockResolvedValue([{ id: 'tag_1', name: 'bug' }])
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_TAGS]({ data: {} })) as { id: string }[]
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('tag_1')
  })
})

// ---------------------------------------------------------------------------
// portal.ts — fetchPublicRoadmaps
// ---------------------------------------------------------------------------

describe('portal.ts fetchPublicRoadmaps — portal-visibility gate', () => {
  it('returns empty array when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })
    const h = await loadModule(PORTAL)
    const result = await h[FETCH_PUBLIC_ROADMAPS]({ data: {} })
    expect(result).toEqual([])
    expect(mockGetPortalPublicRoadmaps).not.toHaveBeenCalled()
  })

  it('returns roadmaps when access is granted (public portal)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    const now = new Date('2026-01-01T00:00:00.000Z')
    mockGetPortalPublicRoadmaps.mockResolvedValue([
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
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_ROADMAPS]({ data: {} })) as { id: string }[]
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('rm_1')
  })

  it('returns roadmaps when a team member accesses a private portal', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'team' })
    const now = new Date('2026-01-01T00:00:00.000Z')
    mockGetPortalPublicRoadmaps.mockResolvedValue([
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
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_ROADMAPS]({ data: {} })) as { id: string }[]
    expect(result[0].id).toBe('rm_2')
  })
})

// ---------------------------------------------------------------------------
// portal.ts — fetchPublicRoadmapPosts
// ---------------------------------------------------------------------------

describe('portal.ts fetchPublicRoadmapPosts — portal-visibility gate', () => {
  it('returns empty result when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_ROADMAP_POSTS]({
      data: { roadmapId: 'rm_1' },
    })) as Record<string, unknown>
    expect(result['items']).toEqual([])
    expect(result['hasMore']).toBe(false)
    expect(result['total']).toBe(0)
    expect(mockGetPortalPublicRoadmapPosts).not.toHaveBeenCalled()
  })

  it('returns roadmap posts when access is granted (public portal)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockGetPortalPublicRoadmapPosts.mockResolvedValue({
      items: [
        {
          id: 'post_1',
          title: 'Ship it',
          voteCount: 5,
          statusId: 'st_1',
          board: { id: 'b1', name: 'Ideas', slug: 'ideas' },
          roadmapEntry: { postId: 'post_1', roadmapId: 'rm_1', position: 0 },
        },
      ],
      hasMore: false,
      total: 1,
    })
    const h = await loadModule(PORTAL)
    const result = (await h[FETCH_PUBLIC_ROADMAP_POSTS]({
      data: { roadmapId: 'rm_1' },
    })) as { items: { id: string }[] }
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('post_1')
  })
})

// ---------------------------------------------------------------------------
// changelog.ts — getPublicChangelogFn
// ---------------------------------------------------------------------------

describe('changelog.ts getPublicChangelogFn — portal-visibility gate', () => {
  it('throws NotFoundError when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthorized' })
    const h = await loadModule(CHANGELOG)

    await expect(h[GET_PUBLIC_CHANGELOG]({ data: { id: 'cl_secret' } })).rejects.toThrow()
    expect(mockGetPublicChangelogById).not.toHaveBeenCalled()
  })

  it('returns the changelog entry when access is granted (public portal)', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockGetPublicChangelogById.mockResolvedValue({
      id: 'cl_1',
      title: 'Release v1',
      content: 'body',
      publishedAt: new Date('2026-01-01'),
    })
    const h = await loadModule(CHANGELOG)
    const result = (await h[GET_PUBLIC_CHANGELOG]({ data: { id: 'cl_1' } })) as {
      id: string
    }
    expect(result.id).toBe('cl_1')
  })

  it('returns the changelog entry when a team member accesses a private portal', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'team' })
    mockGetPublicChangelogById.mockResolvedValue({
      id: 'cl_2',
      title: 'Release v2',
      content: 'body',
      publishedAt: new Date('2026-02-01'),
    })
    const h = await loadModule(CHANGELOG)
    const result = (await h[GET_PUBLIC_CHANGELOG]({ data: { id: 'cl_2' } })) as { id: string }
    expect(result.id).toBe('cl_2')
  })
})

// ---------------------------------------------------------------------------
// changelog.ts — listPublicChangelogsFn
// ---------------------------------------------------------------------------

describe('changelog.ts listPublicChangelogsFn — portal-visibility gate', () => {
  it('returns empty changelog list when private portal blocks the caller', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: false, reason: 'unauthenticated' })
    const h = await loadModule(CHANGELOG)
    const result = (await h[LIST_PUBLIC_CHANGELOGS]({ data: { limit: 10 } })) as {
      items: unknown[]
      nextCursor: null
      hasMore: boolean
    }
    expect(result.items).toEqual([])
    expect(result.nextCursor).toBeNull()
    expect(result.hasMore).toBe(false)
    expect(mockListPublicChangelogs).not.toHaveBeenCalled()
  })

  it('returns changelog items when the portal is public', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
    mockListPublicChangelogs.mockResolvedValue({
      items: [
        {
          id: 'cl_1',
          title: 'v1.0',
          content: 'body',
          publishedAt: new Date('2026-01-01'),
        },
      ],
      nextCursor: null,
      hasMore: false,
    })
    const h = await loadModule(CHANGELOG)
    const result = (await h[LIST_PUBLIC_CHANGELOGS]({ data: { limit: 10 } })) as {
      items: { id: string }[]
    }
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('cl_1')
  })

  it('returns changelog items when an authorized caller accesses a private portal', async () => {
    mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'domain' })
    mockListPublicChangelogs.mockResolvedValue({
      items: [
        {
          id: 'cl_2',
          title: 'v2.0',
          content: 'body',
          publishedAt: new Date('2026-02-01'),
        },
      ],
      nextCursor: null,
      hasMore: false,
    })
    const h = await loadModule(CHANGELOG)
    const result = (await h[LIST_PUBLIC_CHANGELOGS]({ data: { limit: 10 } })) as {
      items: { id: string }[]
    }
    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('cl_2')
  })
})
