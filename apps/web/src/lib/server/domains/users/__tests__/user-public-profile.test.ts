/**
 * getPublicUserProfile: the sanitized, viewer-scoped sibling of
 * getPortalUserDetail. Pins the privacy contract:
 *
 *  - principal eligibility is enforced IN SQL: type='user' AND an inner
 *    join to `user` (excludes service principals) AND a role allowlist
 *    (user/member/admin) — anonymous and service principals resolve to null;
 *  - every activity query (lists AND counts) composes postViewFilter(actor),
 *    so a viewer never sees activity on boards outside their own visibility;
 *  - zero viewer-visible activity → null (anti-enumeration);
 *  - the public payload carries NO email / company / segments / lastSeenAt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

// --- Hoisted mock state ---

const hoisted = vi.hoisted(() => {
  const selectResults: unknown[][] = []
  const whereCalls: unknown[][] = []
  const innerJoinCalls: unknown[][] = []
  return {
    selectResults,
    whereCalls,
    innerJoinCalls,
    mockPostViewFilter: vi.fn(() => 'POST_VIEW_FILTER'),
    mockAnd: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
    mockEq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
    mockInArray: vi.fn((col: unknown, vals: unknown) => ({ op: 'inArray', col, vals })),
    mockIsNull: vi.fn((col: unknown) => ({ op: 'isNull', col })),
    mockGetPublicUrlOrNull: vi.fn(() => null),
  }
})

// Sentinel table objects so predicates are inspectable.
const TABLES = vi.hoisted(() => ({
  principal: {
    id: 'principal.id',
    userId: 'principal.userId',
    displayName: 'principal.displayName',
    avatarUrl: 'principal.avatarUrl',
    role: 'principal.role',
    type: 'principal.type',
    createdAt: 'principal.createdAt',
    contactEmail: 'principal.contactEmail',
    companyId: 'principal.companyId',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
    image: 'user.image',
    imageKey: 'user.imageKey',
  },
  posts: {
    id: 'posts.id',
    title: 'posts.title',
    boardId: 'posts.boardId',
    statusId: 'posts.statusId',
    principalId: 'posts.principalId',
    createdAt: 'posts.createdAt',
    deletedAt: 'posts.deletedAt',
  },
  postComments: {
    postId: 'postComments.postId',
    principalId: 'postComments.principalId',
    isPrivate: 'postComments.isPrivate',
    createdAt: 'postComments.createdAt',
    deletedAt: 'postComments.deletedAt',
  },
  postVotes: {
    postId: 'postVotes.postId',
    principalId: 'postVotes.principalId',
    createdAt: 'postVotes.createdAt',
  },
  postStatuses: { id: 'postStatuses.id', name: 'postStatuses.name', color: 'postStatuses.color' },
  boards: { id: 'boards.id', slug: 'boards.slug', deletedAt: 'boards.deletedAt' },
  userSegments: { principalId: 'userSegments.principalId', segmentId: 'userSegments.segmentId' },
  segments: {
    id: 'segments.id',
    name: 'segments.name',
    color: 'segments.color',
    deletedAt: 'segments.deletedAt',
  },
  companies: {
    id: 'companies.id',
    name: 'companies.name',
    plan: 'companies.plan',
    mrrCents: 'companies.mrrCents',
  },
}))

function createChain(resolveValue: unknown) {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'leftJoin', 'orderBy', 'limit', 'groupBy', 'offset']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.innerJoin = vi.fn((...args: unknown[]) => {
    hoisted.innerJoinCalls.push(args)
    return chain
  })
  chain.where = vi.fn((...args: unknown[]) => {
    hoisted.whereCalls.push(args)
    return chain
  })
  chain.then = (resolve: (v: unknown) => void) => {
    resolve(resolveValue)
    return Promise.resolve(resolveValue)
  }
  return chain
}

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn(() => createChain(hoisted.selectResults.shift() ?? [])),
  },
  eq: hoisted.mockEq,
  and: hoisted.mockAnd,
  inArray: hoisted.mockInArray,
  isNull: hoisted.mockIsNull,
  desc: vi.fn((c: unknown) => c),
  asc: vi.fn((c: unknown) => c),
  sql: Object.assign(
    vi.fn(() => ({ as: vi.fn().mockReturnValue('sql_expr') })),
    { join: vi.fn(), raw: vi.fn() }
  ),
  ...TABLES,
}))

vi.mock('@/lib/server/policy', () => ({
  postViewFilter: hoisted.mockPostViewFilter,
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: hoisted.mockGetPublicUrlOrNull,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

import { getPublicUserProfile, getProfileTeamContext } from '../user.public-profile'

const PRINCIPAL_ID = 'principal_test1' as PrincipalId

const VIEWER: Actor = {
  principalId: null,
  role: null,
  principalType: 'anonymous',
  segmentIds: new Set(),
  permissions: new Set(),
}

const OWNER_ROW = {
  principalId: PRINCIPAL_ID,
  displayName: 'Alice',
  principalAvatarUrl: 'https://cdn.example/principal.png',
  role: 'user',
  joinedAt: new Date('2025-03-01T00:00:00Z'),
  userName: 'Alice A',
  userImage: null,
  userImageKey: null,
}

const POST_ROW = {
  postId: 'post_1',
  title: 'Dark mode',
  boardSlug: 'features',
  statusName: 'Open',
  statusColor: '#00f',
  occurredAt: new Date('2026-01-01T00:00:00Z'),
}

/** Queue results for: owner lookup, then [posts, comments, votes, 3 counts]. */
function queueProfileQueries(opts: {
  owner?: unknown[]
  posts?: unknown[]
  comments?: unknown[]
  votes?: unknown[]
  counts?: [number, number, number]
}) {
  const counts = opts.counts ?? [0, 0, 0]
  hoisted.selectResults.push(
    opts.owner ?? [],
    opts.posts ?? [],
    opts.comments ?? [],
    opts.votes ?? [],
    [{ count: counts[0] }],
    [{ count: counts[1] }],
    [{ count: counts[2] }]
  )
}

beforeEach(() => {
  hoisted.selectResults.length = 0
  hoisted.whereCalls.length = 0
  hoisted.innerJoinCalls.length = 0
  vi.clearAllMocks()
})

describe('getPublicUserProfile', () => {
  it('returns null when no eligible principal row matches (anonymous/service/unknown)', async () => {
    // Anonymous and service principals never match the SQL predicate
    // (type='user' + INNER JOIN user + role allowlist), so the DB returns
    // no row — the function must resolve null without running activity queries.
    queueProfileQueries({ owner: [] })
    const result = await getPublicUserProfile(PRINCIPAL_ID, VIEWER)
    expect(result).toBeNull()
    // Only the owner lookup ran.
    expect(hoisted.whereCalls.length).toBe(1)
  })

  it('enforces eligibility in SQL: type=user, role allowlist, INNER JOIN to user', async () => {
    queueProfileQueries({ owner: [] })
    await getPublicUserProfile(PRINCIPAL_ID, VIEWER)

    // eq(principal.type, 'user') was part of the owner predicate.
    expect(hoisted.mockEq).toHaveBeenCalledWith(TABLES.principal.type, 'user')
    // inArray(principal.role, ['user','member','admin'])
    expect(hoisted.mockInArray).toHaveBeenCalledWith(
      TABLES.principal.role,
      expect.arrayContaining(['user', 'member', 'admin'])
    )
    // INNER join to user (excludes service principals with null userId).
    expect(hoisted.innerJoinCalls.length).toBeGreaterThan(0)
  })

  it('returns null when the principal has zero viewer-visible activity', async () => {
    queueProfileQueries({ owner: [OWNER_ROW], counts: [0, 0, 0] })
    const result = await getPublicUserProfile(PRINCIPAL_ID, VIEWER)
    expect(result).toBeNull()
  })

  it('composes postViewFilter(actor) into every activity query (lists and counts)', async () => {
    queueProfileQueries({ owner: [OWNER_ROW], posts: [POST_ROW], counts: [1, 0, 0] })
    await getPublicUserProfile(PRINCIPAL_ID, VIEWER)

    expect(hoisted.mockPostViewFilter).toHaveBeenCalledWith(VIEWER)

    // 7 where calls total: 1 owner + 3 lists + 3 counts. All six activity
    // predicates must include the viewer filter sentinel.
    expect(hoisted.whereCalls.length).toBe(7)
    const activityPredicates = hoisted.mockAnd.mock.calls.filter((args) =>
      args.includes('POST_VIEW_FILTER')
    )
    expect(activityPredicates.length).toBe(6)
  })

  it('excludes private comments from the comments activity predicate', async () => {
    queueProfileQueries({ owner: [OWNER_ROW], comments: [POST_ROW], counts: [0, 1, 0] })
    await getPublicUserProfile(PRINCIPAL_ID, VIEWER)
    expect(hoisted.mockEq).toHaveBeenCalledWith(TABLES.postComments.isPrivate, false)
  })

  it('returns the sanitized payload with no email/company/segments/lastSeenAt', async () => {
    queueProfileQueries({
      owner: [{ ...OWNER_ROW, role: 'member' }],
      posts: [POST_ROW],
      counts: [3, 2, 1],
    })
    const result = await getPublicUserProfile(PRINCIPAL_ID, VIEWER)

    expect(result).not.toBeNull()
    expect(result!.principalId).toBe(PRINCIPAL_ID)
    expect(result!.displayName).toBe('Alice')
    expect(result!.isTeamMember).toBe(true)
    expect(result!.postCount).toBe(3)
    expect(result!.commentCount).toBe(2)
    expect(result!.voteCount).toBe(1)
    expect(result!.posts).toHaveLength(1)
    expect(result!.posts[0]).toMatchObject({ postId: 'post_1', boardSlug: 'features' })

    const keys = Object.keys(result!)
    expect(keys).not.toContain('email')
    expect(keys).not.toContain('contactEmail')
    expect(keys).not.toContain('company')
    expect(keys).not.toContain('segments')
    expect(keys).not.toContain('lastSeenAt')
    expect(keys).not.toContain('role')
  })

  it('applies the canonical avatar precedence: user.image -> imageKey URL -> principal.avatarUrl', async () => {
    queueProfileQueries({
      owner: [{ ...OWNER_ROW, userImage: 'https://img.example/u.png' }],
      posts: [POST_ROW],
      counts: [1, 0, 0],
    })
    const result = await getPublicUserProfile(PRINCIPAL_ID, VIEWER)
    expect(result!.avatarUrl).toBe('https://img.example/u.png')
  })
})

describe('getProfileTeamContext', () => {
  it('returns null for an ineligible principal', async () => {
    hoisted.selectResults.push([])
    const result = await getProfileTeamContext(PRINCIPAL_ID)
    expect(result).toBeNull()
  })

  it('sanitizes the synthetic anonymous email to null', async () => {
    hoisted.selectResults.push(
      [
        {
          principalId: PRINCIPAL_ID,
          email: 'temp-abc123@anon.quackback.io',
          contactEmail: null,
          companyId: null,
          companyName: null,
          companyPlan: null,
          companyMrrCents: null,
        },
      ],
      [] // segments
    )
    const result = await getProfileTeamContext(PRINCIPAL_ID)
    expect(result).not.toBeNull()
    expect(result!.email).toBeNull()
  })

  it('returns email, company, and segments for a full profile', async () => {
    hoisted.selectResults.push(
      [
        {
          principalId: PRINCIPAL_ID,
          email: 'alice@acme.com',
          contactEmail: null,
          companyId: 'company_1',
          companyName: 'Acme',
          companyPlan: 'Scale',
          companyMrrCents: 129900,
        },
      ],
      [{ id: 'segment_1', name: 'Beta users', color: '#f00' }]
    )
    const result = await getProfileTeamContext(PRINCIPAL_ID)
    expect(result).toEqual({
      email: 'alice@acme.com',
      company: { id: 'company_1', name: 'Acme', plan: 'Scale', mrrCents: 129900 },
      segments: [{ id: 'segment_1', name: 'Beta users', color: '#f00' }],
    })
  })
})
