import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId } from '@quackback/ids'
import { searchShippedPosts } from '../changelog.query'

const mockStatusesFindMany = vi.fn()
const mockSelect = vi.fn()
const mockOrderBy = vi.fn()
const mockLimit = vi.fn()
const mockWhere = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      postStatuses: {
        findMany: (...args: unknown[]) => mockStatusesFindMany(...args),
      },
    },
    select: (...args: unknown[]) => mockSelect(...args),
  },
  posts: {
    id: 'posts.id',
    title: 'posts.title',
    voteCount: 'posts.voteCount',
    boardId: 'posts.boardId',
    principalId: 'posts.principalId',
    statusId: 'posts.statusId',
    createdAt: 'posts.createdAt',
    updatedAt: 'posts.updatedAt',
    deletedAt: 'posts.deletedAt',
  },
  boards: {
    id: 'boards.id',
    slug: 'boards.slug',
  },
  principal: {
    id: 'principal.id',
  },
  postStatuses: {
    id: 'postStatuses.id',
    category: 'postStatuses.category',
  },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  isNull: vi.fn((col) => ({ kind: 'isNull', col })),
  desc: vi.fn((col) => ({ kind: 'desc', col })),
  inArray: vi.fn((col, vals) => ({ kind: 'inArray', col, vals })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
    as: (alias: string) => ({ kind: 'sql_alias', alias }),
  })),
}))

function createSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn((cond: unknown) => {
      mockWhere(cond)
      return chain
    }),
    orderBy: vi.fn((...cols: unknown[]) => {
      mockOrderBy(...cols)
      // Secondary query for includeIds awaits .orderBy() directly; primary query chains .limit().
      const orderPromise = Promise.resolve(rows) as Promise<unknown[]> & {
        limit: (n: number) => Promise<unknown[]>
      }
      orderPromise.limit = (n: number) => {
        mockLimit(n)
        return Promise.resolve(rows)
      }
      return orderPromise
    }),
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('searchShippedPosts', () => {
  it('returns empty array when no complete statuses exist', async () => {
    mockStatusesFindMany.mockResolvedValue([])

    const result = await searchShippedPosts({})

    expect(result).toEqual([])
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('orders by updatedAt DESC, voteCount DESC, createdAt DESC and defaults limit to 100', async () => {
    mockStatusesFindMany.mockResolvedValue([{ id: 'status_complete' }])
    const rows = [
      {
        id: 'post_recent' as PostId,
        title: 'Newly shipped feature',
        voteCount: 1,
        boardSlug: 'feature-requests',
        authorName: 'Alice',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'post_older_popular' as PostId,
        title: 'Older popular feature',
        voteCount: 25,
        boardSlug: 'feature-requests',
        authorName: 'Bob',
        createdAt: new Date('2025-06-01T00:00:00Z'),
      },
    ]
    mockSelect.mockReturnValueOnce(createSelectChain(rows))

    const result = await searchShippedPosts({})

    expect(result).toEqual(rows)
    expect(mockOrderBy).toHaveBeenCalledWith(
      { kind: 'desc', col: 'posts.updatedAt' },
      { kind: 'desc', col: 'posts.voteCount' },
      { kind: 'desc', col: 'posts.createdAt' }
    )
    expect(mockLimit).toHaveBeenCalledWith(100)
  })

  it('fetches and appends missing includeIds when linked posts fall outside the primary query', async () => {
    mockStatusesFindMany.mockResolvedValue([{ id: 'status_complete' }])
    const primaryRows = [
      {
        id: 'post_1' as PostId,
        title: 'First shipped post',
        voteCount: 5,
        boardSlug: 'general',
        authorName: 'Alice',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      },
    ]
    const includedRows = [
      {
        id: 'post_linked_beyond_limit' as PostId,
        title: 'Older linked post beyond limit',
        voteCount: 1,
        boardSlug: 'bugs',
        authorName: 'Charlie',
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
    ]
    mockSelect
      .mockReturnValueOnce(createSelectChain(primaryRows))
      .mockReturnValueOnce(createSelectChain(includedRows))

    const result = await searchShippedPosts({
      limit: 1,
      includeIds: ['post_1' as PostId, 'post_linked_beyond_limit' as PostId],
    })

    expect(mockSelect).toHaveBeenCalledTimes(2)
    expect(mockWhere).toHaveBeenNthCalledWith(2, {
      kind: 'and',
      args: [
        { kind: 'inArray', col: 'posts.id', vals: ['post_linked_beyond_limit'] },
        { kind: 'inArray', col: 'posts.statusId', vals: ['status_complete'] },
        { kind: 'isNull', col: 'posts.deletedAt' },
      ],
    })
    expect(result).toEqual([...primaryRows, ...includedRows])
  })

  it('skips the secondary query when all includeIds are already in the primary results', async () => {
    mockStatusesFindMany.mockResolvedValue([{ id: 'status_complete' }])
    const primaryRows = [
      {
        id: 'post_1' as PostId,
        title: 'Already present',
        voteCount: 3,
        boardSlug: 'general',
        authorName: 'Alice',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      },
    ]
    mockSelect.mockReturnValueOnce(createSelectChain(primaryRows))

    const result = await searchShippedPosts({
      includeIds: ['post_1' as PostId],
    })

    expect(mockSelect).toHaveBeenCalledTimes(1)
    expect(result).toEqual(primaryRows)
  })
})
