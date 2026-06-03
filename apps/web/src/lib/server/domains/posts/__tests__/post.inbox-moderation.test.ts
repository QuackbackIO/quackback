import { beforeEach, describe, expect, it, vi } from 'vitest'

// Symbolic column markers — let us assert exact column identity in mock calls.
const mockPostsDeletedAt = Symbol('posts.deletedAt')
const mockPostsModerationState = Symbol('posts.moderationState')

const mockPosts = {
  id: Symbol('posts.id'),
  boardId: Symbol('posts.boardId'),
  principalId: Symbol('posts.principalId'),
  ownerPrincipalId: Symbol('posts.ownerPrincipalId'),
  statusId: Symbol('posts.statusId'),
  canonicalPostId: Symbol('posts.canonicalPostId'),
  deletedAt: mockPostsDeletedAt,
  moderationState: mockPostsModerationState,
  voteCount: Symbol('posts.voteCount'),
  commentCount: Symbol('posts.commentCount'),
  createdAt: Symbol('posts.createdAt'),
  updatedAt: Symbol('posts.updatedAt'),
  searchVector: Symbol('posts.searchVector'),
}

const mockNe = vi.fn((col, val) => ({ _tag: 'ne', col, val }))
const mockIsNull = vi.fn((col) => ({ _tag: 'isNull', col }))
const mockIsNotNull = vi.fn((col) => ({ _tag: 'isNotNull', col }))
const mockAnd = vi.fn((...args) => ({ _tag: 'and', args }))
const mockInArray = vi.fn((col, arr) => ({ _tag: 'inArray', col, arr }))
const mockDesc = vi.fn((col) => ({ _tag: 'desc', col }))
const mockAsc = vi.fn((col) => ({ _tag: 'asc', col }))
const mockEq = vi.fn((col, val) => ({ _tag: 'eq', col, val }))

// db.query.posts.findMany is what listInboxPosts uses for the main fetch.
const mockPostsFindMany = vi.fn().mockResolvedValue([])
const mockPostsFindFirst = vi.fn().mockResolvedValue(null)

// db.select chain used for subqueries (statusSlugs / tags / segments).
const mockSubWhere = vi.fn().mockReturnValue(Symbol('subquery'))
const mockDbSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: mockSubWhere,
  }),
  selectDistinct: vi.fn(),
})

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      posts: {
        findMany: (...args: unknown[]) => mockPostsFindMany(...args),
        findFirst: (...args: unknown[]) => mockPostsFindFirst(...args),
      },
    },
    select: mockDbSelect,
    selectDistinct: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: mockSubWhere }),
    }),
  },
  posts: mockPosts,
  postStatuses: { id: Symbol('postStatuses.id'), slug: Symbol('postStatuses.slug') },
  postTags: { postId: Symbol('postTags.postId'), tagId: Symbol('postTags.tagId') },
  userSegments: {
    principalId: Symbol('userSegments.principalId'),
    segmentId: Symbol('userSegments.segmentId'),
  },
  ne: mockNe,
  eq: mockEq,
  and: mockAnd,
  or: vi.fn((...args) => ({ _tag: 'or', args })),
  isNull: mockIsNull,
  isNotNull: mockIsNotNull,
  inArray: mockInArray,
  desc: mockDesc,
  asc: mockAsc,
  sql: vi.fn(() => ({})),
}))

describe('listInboxPosts — pending moderation exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPostsFindMany.mockResolvedValue([])
    mockPostsFindFirst.mockResolvedValue(null)
  })

  it('excludes pending posts (adds ne(moderationState, "pending")) in normal view', async () => {
    const { listInboxPosts } = await import('../post.inbox')

    await listInboxPosts({})

    // ne(posts.moderationState, 'pending') must appear in the normal (non-deleted) view
    const neCall = mockNe.mock.calls.find(
      ([col, val]) => col === mockPostsModerationState && val === 'pending'
    )
    expect(neCall).toBeDefined()
  })

  it('does NOT exclude pending posts (no ne(moderationState)) in the deleted view', async () => {
    const { listInboxPosts } = await import('../post.inbox')

    await listInboxPosts({ showDeleted: true })

    const neCall = mockNe.mock.calls.find(
      ([col, val]) => col === mockPostsModerationState && val === 'pending'
    )
    expect(neCall).toBeUndefined()
  })

  it('isNull(deletedAt) is present in normal view alongside the pending exclusion', async () => {
    const { listInboxPosts } = await import('../post.inbox')

    await listInboxPosts({})

    const isNullCall = mockIsNull.mock.calls.find(([col]) => col === mockPostsDeletedAt)
    expect(isNullCall).toBeDefined()

    const neCall = mockNe.mock.calls.find(
      ([col, val]) => col === mockPostsModerationState && val === 'pending'
    )
    expect(neCall).toBeDefined()
  })

  it('isNotNull(deletedAt) is present in the deleted view with no pending exclusion', async () => {
    const { listInboxPosts } = await import('../post.inbox')

    await listInboxPosts({ showDeleted: true })

    const isNotNullCall = mockIsNotNull.mock.calls.find(([col]) => col === mockPostsDeletedAt)
    expect(isNotNullCall).toBeDefined()

    const neCall = mockNe.mock.calls.find(
      ([col, val]) => col === mockPostsModerationState && val === 'pending'
    )
    expect(neCall).toBeUndefined()
  })
})
