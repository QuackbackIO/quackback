/**
 * Tests for listPortalUsers filter handling.
 *
 * Covers:
 * - Basic pagination and default behavior
 * - Email domain filter
 * - Activity count filters (postCount, voteCount, commentCount)
 * - Custom attribute filters
 * - Segment membership filter
 * - Combination of multiple filters
 * - Sort options
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

// --- Hoisted mock state (available inside vi.mock factories) ---

const { mockIlike, mockEq, mockInArray, mockSql, mockOr, mockAnd, selectCallCount } = vi.hoisted(
  () => ({
    mockIlike: vi.fn(() => 'ilike_result'),
    mockEq: vi.fn(() => 'eq_result'),
    mockInArray: vi.fn(() => 'inArray_result'),
    mockSql: vi.fn(() => ({ as: vi.fn().mockReturnValue('mock_sql_result') })),
    mockOr: vi.fn((...args: unknown[]) => args),
    mockAnd: vi.fn((...args: unknown[]) => args),
    selectCallCount: { count: 0 },
  })
)

// Mock user data that the query chain resolves to
const mockUserRows = [
  {
    principalId: 'principal_1' as PrincipalId,
    userId: 'user_1',
    name: 'Alice',
    email: 'alice@example.com',
    image: null,
    emailVerified: true,
    metadata: null,
    joinedAt: new Date('2024-01-01'),
    postCount: 3,
    commentCount: 5,
    voteCount: 10,
  },
]

const mockCountResult = [{ count: 1 }]

// Universal chainable mock for Drizzle query builder
function createChain(resolveValue: unknown = []) {
  const chain: Record<string, unknown> = {}
  for (const m of [
    'select',
    'from',
    'innerJoin',
    'leftJoin',
    'where',
    'orderBy',
    'limit',
    'offset',
    'groupBy',
  ]) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.as = vi.fn().mockReturnValue({
    principalId: 'mock_col',
    postCount: 'post_count',
    commentCount: 'comment_count',
    voteCount: 'vote_count',
  })
  chain.then = (resolve: (v: unknown) => void) => {
    resolve(resolveValue)
    return Promise.resolve(resolveValue)
  }
  return chain
}

vi.mock('@/lib/server/db', () => ({
  db: {
    select: vi.fn(() => {
      selectCallCount.count++
      const c = selectCallCount.count
      if (c <= 3) return createChain([]) // subqueries
      if (c === 4) return createChain(mockUserRows) // main query
      if (c === 5) return createChain(mockCountResult) // count query
      return createChain([]) // segment/other queries
    }),
    query: {
      user: { findFirst: vi.fn() },
      principal: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
  },
  eq: mockEq,
  and: mockAnd,
  or: mockOr,
  ilike: mockIlike,
  inArray: mockInArray,
  isNull: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  sql: mockSql,
  principal: {
    id: 'principal.id',
    userId: 'principal.user_id',
    role: 'principal.role',
    createdAt: 'principal.created_at',
  },
  user: {
    id: 'user.id',
    name: 'user.name',
    email: 'user.email',
    image: 'user.image',
    emailVerified: 'user.email_verified',
    metadata: 'user.metadata',
    createdAt: 'user.created_at',
    updatedAt: 'user.updated_at',
  },
  posts: { principalId: 'posts.principal_id', deletedAt: 'posts.deleted_at' },
  comments: { principalId: 'comments.principal_id', deletedAt: 'comments.deleted_at' },
  votes: { principalId: 'votes.principal_id' },
  postStatuses: {},
  boards: {},
  userSegments: {
    principalId: 'user_segments.principal_id',
    segmentId: 'user_segments.segment_id',
  },
  segments: {
    id: 'segments.id',
    name: 'segments.name',
    color: 'segments.color',
    type: 'segments.type',
    deletedAt: 'segments.deleted_at',
  },
  userAttributeDefinitions: 'user_attribute_definitions',
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn((p: string) => `${p}_generated123`),
}))

vi.mock('@/lib/shared/errors', () => ({
  NotFoundError: class extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  },
  ValidationError: class extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  },
  InternalError: class extends Error {
    code: string
    constructor(c: string, m: string) {
      super(m)
      this.code = c
    }
  },
}))

describe('listPortalUsers', () => {
  beforeEach(async () => {
    selectCallCount.count = 0
    vi.clearAllMocks()

    // Re-wire db.select after clearAllMocks
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.select).mockImplementation(() => {
      selectCallCount.count++
      const c = selectCallCount.count
      if (c <= 3) return createChain([]) as never
      if (c === 4) return createChain(mockUserRows) as never
      if (c === 5) return createChain(mockCountResult) as never
      return createChain([]) as never
    })
  })

  it('should return paginated results with default params', async () => {
    const { listPortalUsers } = await import('../user.service')
    const result = await listPortalUsers()

    expect(result).toHaveProperty('items')
    expect(result).toHaveProperty('total')
    expect(result).toHaveProperty('hasMore')
    expect(Array.isArray(result.items)).toBe(true)
  })

  it('should include activity counts in results', async () => {
    const { listPortalUsers } = await import('../user.service')
    const result = await listPortalUsers()

    const item = result.items[0]
    expect(item).toBeDefined()
    expect(typeof item.postCount).toBe('number')
    expect(typeof item.commentCount).toBe('number')
    expect(typeof item.voteCount).toBe('number')
  })

  it('should include segments array in results', async () => {
    const { listPortalUsers } = await import('../user.service')
    const result = await listPortalUsers()

    expect(result.items[0]).toBeDefined()
    expect(Array.isArray(result.items[0].segments)).toBe(true)
  })

  it('should filter by email domain using ilike', async () => {
    const { listPortalUsers } = await import('../user.service')
    await listPortalUsers({ emailDomain: 'example.com' })

    expect(mockIlike).toHaveBeenCalledWith('user.email', '%@example.com')
  })

  it('should use sql for activity count filters', async () => {
    const { listPortalUsers } = await import('../user.service')
    await listPortalUsers({ postCount: { op: 'gte', value: 5 } })

    // sql is called for COALESCE and comparison expressions
    expect(mockSql).toHaveBeenCalled()
  })

  it('should accept all activity count operators', async () => {
    const { listPortalUsers } = await import('../user.service')

    for (const op of ['gt', 'gte', 'lt', 'lte', 'eq'] as const) {
      selectCallCount.count = 0
      await expect(listPortalUsers({ postCount: { op, value: 3 } })).resolves.toBeDefined()
    }
  })

  it('should filter by segment membership using inArray', async () => {
    const { listPortalUsers } = await import('../user.service')
    await listPortalUsers({
      segmentIds: ['seg_123' as unknown as import('@quackback/ids').SegmentId],
    })

    expect(mockInArray).toHaveBeenCalled()
  })

  it('should use sql for custom attribute eq filter', async () => {
    const { listPortalUsers } = await import('../user.service')
    await listPortalUsers({
      customAttrs: [{ key: 'plan', op: 'eq', value: 'enterprise' }],
    })

    expect(mockSql).toHaveBeenCalled()
  })

  it('should handle all custom attribute operators', async () => {
    const { listPortalUsers } = await import('../user.service')

    for (const op of [
      'eq',
      'neq',
      'contains',
      'starts_with',
      'ends_with',
      'gt',
      'gte',
      'lt',
      'lte',
      'is_set',
      'is_not_set',
    ]) {
      selectCallCount.count = 0
      await expect(
        listPortalUsers({ customAttrs: [{ key: 'test', op, value: 'val' }] })
      ).resolves.toBeDefined()
    }
  })

  it('should handle multiple custom attribute filters', async () => {
    const { listPortalUsers } = await import('../user.service')
    const result = await listPortalUsers({
      customAttrs: [
        { key: 'plan', op: 'eq', value: 'enterprise' },
        { key: 'mrr', op: 'gt', value: '500' },
        { key: 'active', op: 'is_set', value: '' },
      ],
    })

    expect(result.items).toBeDefined()
  })

  it('should filter by verified status', async () => {
    const { listPortalUsers } = await import('../user.service')
    await listPortalUsers({ verified: true })

    expect(mockEq).toHaveBeenCalledWith('user.email_verified', true)
  })

  it('should filter by search term on name and email', async () => {
    const { listPortalUsers } = await import('../user.service')
    await listPortalUsers({ search: 'alice' })

    expect(mockIlike).toHaveBeenCalledWith('user.name', '%alice%')
    expect(mockIlike).toHaveBeenCalledWith('user.email', '%alice%')
    expect(mockOr).toHaveBeenCalled()
  })

  it('should handle all sort options without error', async () => {
    const { listPortalUsers } = await import('../user.service')

    for (const sort of [
      'newest',
      'oldest',
      'most_active',
      'most_posts',
      'most_comments',
      'most_votes',
      'name',
    ] as const) {
      selectCallCount.count = 0
      await expect(listPortalUsers({ sort })).resolves.toBeDefined()
    }
  })

  it('should use sql for date range filters', async () => {
    const { listPortalUsers } = await import('../user.service')
    await listPortalUsers({
      dateFrom: new Date('2024-01-01'),
      dateTo: new Date('2024-12-31'),
    })

    expect(mockSql).toHaveBeenCalled()
  })

  it('should compute hasMore correctly', async () => {
    const { listPortalUsers } = await import('../user.service')
    const result = await listPortalUsers({ page: 1, limit: 20 })

    // total=1, page=1, limit=20 → 1*20=20 > 1 → hasMore=false
    expect(result.hasMore).toBe(false)
  })

  it('should combine multiple filter types', async () => {
    const { listPortalUsers } = await import('../user.service')
    await listPortalUsers({
      search: 'test',
      emailDomain: 'example.com',
      verified: true,
      postCount: { op: 'gte', value: 3 },
    })

    expect(mockIlike).toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalled()
    expect(mockSql).toHaveBeenCalled()
  })

  it('should default to page 1 with limit 20', async () => {
    const { listPortalUsers } = await import('../user.service')
    const result = await listPortalUsers({})

    expect(result.total).toBe(1)
    expect(result.items).toHaveLength(1)
  })
})
