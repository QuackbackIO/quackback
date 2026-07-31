/**
 * Inbox priority sort: posts can be ordered by a computed priority score
 * combining votes, comment activity, and recency. Verifies the score
 * expression drives ordering and that keyset pagination compares the cursor
 * post's computed score, not a stored column.
 *
 * Pure unit test, no real DB — mirrors post.inbox-moderation.test.ts's
 * symbolic-mock idiom, with an sql mock that captures template text.
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

const mockDesc = vi.fn((col) => ({ _tag: 'desc', col }))
const mockAsc = vi.fn((col) => ({ _tag: 'asc', col }))
const mockAnd = vi.fn((...args) => ({ _tag: 'and', args }))
const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
  _tag: 'sql',
  text: strings.join('?'),
  values,
}))

const mockPostsFindMany = vi.fn().mockResolvedValue([])
const mockPostsFindFirst = vi.fn().mockResolvedValue(null)

// db.select chain: where() is awaitable (the cursor score lookup) and also
// usable as an un-awaited subquery marker for inArray filters.
const mockSubWhere = vi.fn(() =>
  Object.assign(Promise.resolve([{ score: 42 }]), { _tag: 'subquery' })
)
const mockDbSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({ where: mockSubWhere }),
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
  postTagAssignments: {
    postId: Symbol('postTagAssignments.postId'),
    tagId: Symbol('postTagAssignments.tagId'),
  },
  userSegments: {
    principalId: Symbol('userSegments.principalId'),
    segmentId: Symbol('userSegments.segmentId'),
  },
  ne: vi.fn((col, val) => ({ _tag: 'ne', col, val })),
  eq: vi.fn((col, val) => ({ _tag: 'eq', col, val })),
  and: mockAnd,
  isNull: vi.fn((col) => ({ _tag: 'isNull', col })),
  isNotNull: vi.fn((col) => ({ _tag: 'isNotNull', col })),
  inArray: vi.fn((col, arr) => ({ _tag: 'inArray', col, arr })),
  desc: mockDesc,
  asc: mockAsc,
  sql: mockSql,
}))

async function loadListInboxPosts() {
  const { listInboxPosts } = await import('../post.inbox')
  return listInboxPosts
}

function sqlFragments(): Array<{ text: string; values: unknown[] }> {
  return mockSql.mock.results
    .map((r) => r.value)
    .filter((v): v is { _tag: string; text: string; values: unknown[] } => v?._tag === 'sql')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPostsFindMany.mockResolvedValue([])
  mockPostsFindFirst.mockResolvedValue(null)
})

describe('listInboxPosts — priority sort', () => {
  it('orders by the computed priority score combining votes, comments, and recency', async () => {
    const listInboxPosts = await loadListInboxPosts()
    await listInboxPosts({ sort: 'priority' })

    const orderBy = mockPostsFindMany.mock.calls[0][0].orderBy
    expect(orderBy[0]).toMatchObject({ _tag: 'desc' })
    const scoreSql = orderBy[0].col
    expect(scoreSql._tag).toBe('sql')
    // Votes and comment activity are the interpolated score terms.
    expect(scoreSql.values).toContain(mockPosts.voteCount)
    expect(scoreSql.values).toContain(mockPosts.commentCount)
    // Recency: a bounded bonus derived from post age.
    expect(scoreSql.text).toContain('GREATEST')
    // Deterministic keyset tiebreakers follow the score.
    expect(orderBy[1]).toMatchObject({ _tag: 'desc', col: mockPosts.createdAt })
    expect(orderBy[2]).toMatchObject({ _tag: 'desc', col: mockPosts.id })
  })

  it('paginates by comparing the cursor post’s computed score', async () => {
    mockPostsFindFirst.mockResolvedValue({
      id: 'post_01h455vb4pex5vsknk084sn02q',
      createdAt: new Date('2026-07-01T00:00:00Z'),
      voteCount: 5,
    })

    const listInboxPosts = await loadListInboxPosts()
    await listInboxPosts({ sort: 'priority', cursor: 'post_01h455vb4pex5vsknk084sn02q' })

    // The cursor post's score is computed via a dedicated lookup.
    expect(mockDbSelect).toHaveBeenCalled()
    // A row-comparison condition embeds the looked-up score (42 from the stub).
    const comparison = sqlFragments().find((f) => f.text.includes('<') && f.values.includes(42))
    expect(comparison).toBeDefined()
  })
})
