/**
 * Public-profile server fns: pins the gate composition.
 *
 *  - getPublicUserProfileFn: portal-access denial → null; invalid TypeID →
 *    null; every miss is shape-identical (null) and the domain query is
 *    never reached when an outer gate fails. The serialized payload carries
 *    no email.
 *
 *  - getProfileTeamContextFn: requires people.view via requireAuth BEFORE
 *    any work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockResolvePortalAccess: vi.fn(),
  mockGetOptionalAuth: vi.fn(),
  mockPolicyActorFromAuth: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockGetPublicUserProfile: vi.fn(),
  mockGetProfileTeamContext: vi.fn(),
}))

type AnyHandler = (ctx: { data: unknown }) => Promise<unknown>

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

vi.mock('@/lib/server/functions/portal-access', () => ({
  resolvePortalAccessForRequest: hoisted.mockResolvePortalAccess,
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: hoisted.mockGetOptionalAuth,
  policyActorFromAuth: hoisted.mockPolicyActorFromAuth,
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/domains/users/user.public-profile', () => ({
  getPublicUserProfile: hoisted.mockGetPublicUserProfile,
  getProfileTeamContext: hoisted.mockGetProfileTeamContext,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

// Importing the SUT registers both handlers: [0] = profile, [1] = team context.
await import('../public-profile')
const profileHandler = handlers[0]
const teamContextHandler = handlers[1]

// A syntactically valid principal TypeID (26-char base32 suffix).
const VALID_ID = 'principal_00000000000000000000000000'

const ACTOR = {
  principalId: null,
  role: null,
  principalType: 'anonymous',
  segmentIds: new Set(),
  permissions: new Set(),
}

const DOMAIN_PROFILE = {
  principalId: VALID_ID,
  displayName: 'Alice',
  avatarUrl: null,
  isTeamMember: false,
  joinedAt: new Date('2025-03-01T00:00:00Z'),
  postCount: 1,
  commentCount: 0,
  voteCount: 0,
  posts: [
    {
      postId: 'post_1',
      title: 'Dark mode',
      boardSlug: 'features',
      statusName: 'Open',
      statusColor: '#00f',
      occurredAt: new Date('2026-01-01T00:00:00Z'),
    },
  ],
  comments: [],
  upvotes: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockResolvePortalAccess.mockResolvedValue({ granted: true, reason: 'public' })
  hoisted.mockGetOptionalAuth.mockResolvedValue(null)
  hoisted.mockPolicyActorFromAuth.mockResolvedValue(ACTOR)
  hoisted.mockGetPublicUserProfile.mockResolvedValue(DOMAIN_PROFILE)
  hoisted.mockRequireAuth.mockResolvedValue({})
  hoisted.mockGetProfileTeamContext.mockResolvedValue({
    email: 'alice@acme.com',
    company: null,
    segments: [],
  })
})

describe('getPublicUserProfileFn', () => {
  it('returns null for an invalid principal id without touching any gate', async () => {
    const result = await profileHandler({ data: { principalId: 'not-a-typeid' } })
    expect(result).toBeNull()
    expect(hoisted.mockResolvePortalAccess).not.toHaveBeenCalled()
    expect(hoisted.mockGetPublicUserProfile).not.toHaveBeenCalled()
  })

  it('returns null when portal access is denied, without querying the profile', async () => {
    hoisted.mockResolvePortalAccess.mockResolvedValue({
      granted: false,
      reason: 'unauthenticated',
    })
    const result = await profileHandler({ data: { principalId: VALID_ID } })
    expect(result).toBeNull()
    expect(hoisted.mockGetPublicUserProfile).not.toHaveBeenCalled()
  })

  it('returns null when the domain resolves no viewer-visible profile', async () => {
    hoisted.mockGetPublicUserProfile.mockResolvedValue(null)
    const result = await profileHandler({ data: { principalId: VALID_ID } })
    expect(result).toBeNull()
  })

  it('resolves the caller actor and passes it to the domain query', async () => {
    await profileHandler({ data: { principalId: VALID_ID } })
    expect(hoisted.mockGetPublicUserProfile).toHaveBeenCalledWith(VALID_ID, ACTOR)
  })

  it('serializes dates and never includes an email field', async () => {
    const result = (await profileHandler({ data: { principalId: VALID_ID } })) as Record<
      string,
      unknown
    >
    expect(result.joinedAt).toBe('2025-03-01T00:00:00.000Z')
    expect((result.posts as Array<{ occurredAt: string }>)[0].occurredAt).toBe(
      '2026-01-01T00:00:00.000Z'
    )
    expect(JSON.stringify(result)).not.toContain('email')
    expect(Object.keys(result)).toEqual([
      'principalId',
      'displayName',
      'avatarUrl',
      'isTeamMember',
      'joinedAt',
      'postCount',
      'commentCount',
      'voteCount',
      'posts',
      'comments',
      'upvotes',
    ])
  })
})

describe('getProfileTeamContextFn', () => {
  it('requires the people.view permission before any work', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(teamContextHandler({ data: { principalId: VALID_ID } })).rejects.toThrow(
      'Access denied'
    )
    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith({ permission: 'people.view' })
    expect(hoisted.mockGetProfileTeamContext).not.toHaveBeenCalled()
  })

  it('returns the team context for a permitted caller', async () => {
    const result = await teamContextHandler({ data: { principalId: VALID_ID } })
    expect(result).toEqual({ email: 'alice@acme.com', company: null, segments: [] })
  })
})
