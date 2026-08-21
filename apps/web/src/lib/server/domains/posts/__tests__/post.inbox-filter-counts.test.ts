/**
 * Inbox filter facet counts: each dimension omits its own filter so the
 * number next to an option is "other currently applied filters + posts that
 * would newly match this option". Pure unit test — mocks drizzle like
 * post.inbox-moderation.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPosts = {
  id: Symbol('posts.id'),
  boardId: Symbol('posts.boardId'),
  principalId: Symbol('posts.principalId'),
  ownerPrincipalId: Symbol('posts.ownerPrincipalId'),
  statusId: Symbol('posts.statusId'),
  canonicalPostId: Symbol('posts.canonicalPostId'),
  deletedAt: Symbol('posts.deletedAt'),
  moderationState: Symbol('posts.moderationState'),
  voteCount: Symbol('posts.voteCount'),
  commentCount: Symbol('posts.commentCount'),
  createdAt: Symbol('posts.createdAt'),
  updatedAt: Symbol('posts.updatedAt'),
  searchVector: Symbol('posts.searchVector'),
}

const mockPostStatuses = { id: Symbol('postStatuses.id'), slug: Symbol('postStatuses.slug') }
const mockTagAssignments = {
  postId: Symbol('postTagAssignments.postId'),
  tagId: Symbol('postTagAssignments.tagId'),
}
const mockUserSegments = {
  principalId: Symbol('userSegments.principalId'),
  segmentId: Symbol('userSegments.segmentId'),
}

const mockNe = vi.fn((col, val) => ({ _tag: 'ne', col, val }))
const mockIsNull = vi.fn((col) => ({ _tag: 'isNull', col }))
const mockIsNotNull = vi.fn((col) => ({ _tag: 'isNotNull', col }))
const mockAnd = vi.fn((...args) => ({ _tag: 'and', args }))
const mockInArray = vi.fn((col, arr) => ({ _tag: 'inArray', col, arr }))
const mockEq = vi.fn((col, val) => ({ _tag: 'eq', col, val }))
const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
  _tag: 'sql',
  text: strings.join('?'),
  values,
}))

function selectBuilder(result: unknown = []) {
  const builder: Record<string | symbol, unknown> = {}
  const passthrough = () => builder
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
    builder[method] = vi.fn(passthrough)
  }
  builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return builder
}

const mockDbSelect = vi.fn(() => selectBuilder())
const mockSelectDistinct = vi.fn(() => selectBuilder())

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      posts: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    select: mockDbSelect,
    selectDistinct: mockSelectDistinct,
  },
  posts: mockPosts,
  postStatuses: mockPostStatuses,
  postTagAssignments: mockTagAssignments,
  userSegments: mockUserSegments,
  ne: mockNe,
  eq: mockEq,
  and: mockAnd,
  isNull: mockIsNull,
  isNotNull: mockIsNotNull,
  inArray: mockInArray,
  desc: vi.fn((col) => ({ _tag: 'desc', col })),
  asc: vi.fn((col) => ({ _tag: 'asc', col })),
  sql: mockSql,
}))

async function loadInbox() {
  return import('../post.inbox')
}

describe('inboxFilterConditions — disjunctive facet omit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies board + status together when nothing is omitted', async () => {
    const { inboxFilterConditions } = await loadInbox()
    inboxFilterConditions({
      boardIds: ['board_1'] as never,
      statusSlugs: ['open'],
    })

    expect(mockInArray.mock.calls.some(([col]) => col === mockPosts.boardId)).toBe(true)
    expect(mockInArray.mock.calls.some(([col]) => col === mockPosts.statusId)).toBe(true)
  })

  it('omitting status keeps other filters (board) and skips the status predicate', async () => {
    const { inboxFilterConditions } = await loadInbox()
    inboxFilterConditions(
      {
        boardIds: ['board_1'] as never,
        statusSlugs: ['open'],
      },
      'status'
    )

    expect(mockInArray.mock.calls.some(([col]) => col === mockPosts.boardId)).toBe(true)
    expect(mockInArray.mock.calls.some(([col]) => col === mockPosts.statusId)).toBe(false)
  })

  it('omitting board keeps the status predicate and skips the board predicate', async () => {
    const { inboxFilterConditions } = await loadInbox()
    inboxFilterConditions(
      {
        boardIds: ['board_1'] as never,
        statusSlugs: ['open'],
      },
      'board'
    )

    expect(mockInArray.mock.calls.some(([col]) => col === mockPosts.boardId)).toBe(false)
    expect(mockInArray.mock.calls.some(([col]) => col === mockPosts.statusId)).toBe(true)
  })

  it('omitting tags skips the tag-assignment subquery', async () => {
    const { inboxFilterConditions } = await loadInbox()
    inboxFilterConditions({ tagIds: ['tag_1'] as never }, 'tags')

    expect(mockInArray.mock.calls.some(([col]) => col === mockPosts.id)).toBe(false)
  })

  it('omitting segments skips the segment membership subquery', async () => {
    const { inboxFilterConditions } = await loadInbox()
    inboxFilterConditions({ segmentIds: ['seg_1'] as never }, 'segments')

    expect(mockInArray.mock.calls.some(([col]) => col === mockPosts.principalId)).toBe(false)
  })

  it('omitting deleted skips both the live and restorable-deleted predicates', async () => {
    const { inboxFilterConditions } = await loadInbox()
    inboxFilterConditions({}, 'deleted')

    expect(mockIsNull.mock.calls.some(([col]) => col === mockPosts.deletedAt)).toBe(false)
    expect(mockIsNotNull.mock.calls.some(([col]) => col === mockPosts.deletedAt)).toBe(false)
    expect(
      mockNe.mock.calls.some(([col, val]) => col === mockPosts.moderationState && val === 'pending')
    ).toBe(false)
  })

  it('still constrains to live (non-deleted) posts when counting a non-deleted facet', async () => {
    const { inboxFilterConditions } = await loadInbox()
    inboxFilterConditions({}, 'status')

    expect(mockIsNull.mock.calls.some(([col]) => col === mockPosts.deletedAt)).toBe(true)
    expect(
      mockNe.mock.calls.some(([col, val]) => col === mockPosts.moderationState && val === 'pending')
    ).toBe(false)
  })
})

describe('countInboxFilterFacets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('issues one grouped query per facet and maps rows onto the count payload', async () => {
    const builders: ReturnType<typeof selectBuilder>[] = []
    mockDbSelect.mockImplementation((cols?: Record<string, unknown>) => {
      let result: unknown = []
      if (cols && 'key' in cols && cols.key === mockPostStatuses.slug) {
        result = [{ key: 'open', count: 4 }]
      } else if (cols && 'key' in cols && cols.key === mockPosts.boardId) {
        result = [{ key: 'board_1', count: 7 }]
      } else if (cols && 'key' in cols && cols.key === mockTagAssignments.tagId) {
        result = [{ key: 'tag_1', count: 2 }]
      } else if (cols && 'key' in cols && cols.key === mockUserSegments.segmentId) {
        result = [{ key: 'seg_1', count: 1 }]
      } else if (cols && 'responded' in cols) {
        result = [{ responded: 3, unresponded: 5 }]
      } else if (cols && 'count' in cols && !('key' in cols)) {
        result = [{ count: 9 }]
      }
      const builder = selectBuilder(result)
      builders.push(builder)
      return builder
    })

    const { countInboxFilterFacets } = await loadInbox()
    const counts = await countInboxFilterFacets({ statusSlugs: ['open'] })

    expect(counts.statuses).toEqual({ open: 4 })
    expect(counts.boards).toEqual({ board_1: 7 })
    expect(counts.tags).toEqual({ tag_1: 2 })
    expect(counts.segments).toEqual({ seg_1: 1 })
    expect(counts.responded).toEqual({ responded: 3, unresponded: 5 })
    expect(counts.deleted).toBe(9)

    expect(
      builders.some((b) => (b.groupBy as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    ).toBe(true)
    expect(
      builders.some((b) => (b.innerJoin as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    ).toBe(true)
  })
})
