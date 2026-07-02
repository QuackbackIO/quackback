/**
 * Differential-coverage tests for changelog.query — listChangelogs status
 * filters + cursor pagination + author/category/product/linked-post enrichment,
 * listChangelogTaxonomy, and searchShippedPosts (no-complete-status short
 * circuit + board/query filters).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  entriesFindFirst: vi.fn(),
  entriesFindMany: vi.fn(),
  principalFindMany: vi.fn(),
  entryPostsFindMany: vi.fn(),
  statusesFindMany: vi.fn(),
  categoriesFindMany: vi.fn(),
  productsFindMany: vi.fn(),
  searchSelect: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      changelogEntries: { findFirst: m.entriesFindFirst, findMany: m.entriesFindMany },
      principal: { findMany: m.principalFindMany },
      changelogEntryPosts: { findMany: m.entryPostsFindMany },
      postStatuses: { findMany: m.statusesFindMany },
      changelogCategories: { findMany: m.categoriesFindMany },
      changelogProducts: { findMany: m.productsFindMany },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: m.searchSelect }) }) }),
      }),
    }),
  },
  boards: { id: 'b.id', slug: 'b.slug' },
  changelogCategories: { id: 'cc.id', name: 'cc.name' },
  changelogEntries: {
    id: 'ce.id',
    deletedAt: 'ce.deletedAt',
    publishedAt: 'ce.publishedAt',
    createdAt: 'ce.createdAt',
  },
  changelogEntryPosts: { changelogEntryId: 'cep.entryId' },
  changelogProducts: { id: 'cp.id', name: 'cp.name' },
  posts: {
    id: 'p.id',
    statusId: 'p.statusId',
    deletedAt: 'p.deletedAt',
    boardId: 'p.boardId',
    title: 'p.title',
    voteCount: 'p.voteCount',
    createdAt: 'p.createdAt',
    principalId: 'p.principalId',
  },
  principal: { id: 'pr.id' },
  postStatuses: { id: 'ps.id', category: 'ps.category' },
  eq: vi.fn(),
  and: vi.fn((...a) => ({ and: a })),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  lt: vi.fn(),
  lte: vi.fn(),
  gt: vi.fn(),
  or: vi.fn((...a) => ({ or: a })),
  desc: vi.fn(),
  asc: vi.fn(),
  inArray: vi.fn(),
  sql: Object.assign((..._a: unknown[]) => ({ __sql: true, as: () => ({ __sql: true }) }), {
    raw: () => ({ __raw: true }),
  }),
}))

vi.mock('../changelog.service', () => ({ computeStatus: () => 'published' }))

import { listChangelogs, listChangelogTaxonomy, searchShippedPosts } from '../changelog.query'

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'cl_1',
  title: 'T',
  content: 'c',
  contentJson: null,
  principalId: null,
  categoryId: null,
  productId: null,
  publishedAt: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.entriesFindFirst.mockResolvedValue(undefined)
  m.entriesFindMany.mockResolvedValue([])
  m.principalFindMany.mockResolvedValue([])
  m.entryPostsFindMany.mockResolvedValue([])
  m.statusesFindMany.mockResolvedValue([])
  m.categoriesFindMany.mockResolvedValue([])
  m.productsFindMany.mockResolvedValue([])
  m.searchSelect.mockResolvedValue([{ id: 'post_1' }])
})

describe('listChangelogs status filters', () => {
  it('handles draft / scheduled / published / all', async () => {
    for (const status of ['draft', 'scheduled', 'published', 'all'] as const) {
      const res = await listChangelogs({ status } as never)
      expect(res).toEqual({ items: [], nextCursor: null, hasMore: false })
    }
  })

  it('applies a found cursor', async () => {
    m.entriesFindFirst.mockResolvedValueOnce({ createdAt: new Date('2026-02-01') })
    await listChangelogs({ cursor: 'cursor_1' } as never)
    expect(m.entriesFindMany).toHaveBeenCalled()
  })
  it('ignores a missing cursor row', async () => {
    m.entriesFindFirst.mockResolvedValueOnce(undefined)
    await listChangelogs({ cursor: 'ghost' } as never)
    expect(m.entriesFindMany).toHaveBeenCalled()
  })
})

describe('listChangelogs enrichment', () => {
  it('maps authors, categories, products, linked posts, and paginates', async () => {
    m.entriesFindMany.mockResolvedValueOnce([
      entry({ id: 'cl_1', principalId: 'pr_1', categoryId: 'cat_1', productId: 'prod_1' }),
      entry({ id: 'cl_2' }),
    ])
    m.principalFindMany.mockResolvedValueOnce([
      { id: 'pr_1', displayName: 'Author', avatarUrl: null },
      { id: 'pr_2', displayName: null, avatarUrl: null }, // no displayName -> skipped
    ])
    m.entryPostsFindMany.mockResolvedValueOnce([
      {
        changelogEntryId: 'cl_1',
        post: { id: 'post_1', title: 'P', voteCount: 2, statusId: 'status_1' },
      },
      {
        changelogEntryId: 'cl_1',
        post: { id: 'post_2', title: 'Q', voteCount: 1, statusId: null },
      },
    ])
    m.statusesFindMany.mockResolvedValueOnce([{ id: 'status_1', name: 'Done', color: '#0f0' }])
    m.categoriesFindMany.mockResolvedValueOnce([
      { id: 'cat_1', name: 'Cat', slug: 'cat', color: '#00f' },
    ])
    m.productsFindMany.mockResolvedValueOnce([{ id: 'prod_1', name: 'Prod', slug: 'prod' }])
    const res = await listChangelogs({ limit: 1 } as never)
    expect(res.hasMore).toBe(true)
    expect(res.items).toHaveLength(1)
    expect(res.items[0].author).toMatchObject({ name: 'Author' })
    expect(res.items[0].linkedPosts[0].status).toMatchObject({ name: 'Done' })
    expect(res.items[0].linkedPosts[1].status).toBeNull()
    expect(res.nextCursor).toBe('cl_1')
  })
  it('leaves author/category/product null when the entry has none', async () => {
    m.entriesFindMany.mockResolvedValueOnce([entry()])
    const res = await listChangelogs({} as never)
    expect(res.items[0].author).toBeNull()
    expect(res.items[0].category).toBeNull()
    expect(res.items[0].product).toBeNull()
  })
})

describe('listChangelogTaxonomy', () => {
  it('returns categories and products', async () => {
    m.categoriesFindMany.mockResolvedValueOnce([{ id: 'cat_1' }])
    m.productsFindMany.mockResolvedValueOnce([{ id: 'prod_1' }])
    expect(await listChangelogTaxonomy()).toEqual({
      categories: [{ id: 'cat_1' }],
      products: [{ id: 'prod_1' }],
    })
  })
})

describe('searchShippedPosts', () => {
  it('short-circuits when no complete statuses exist', async () => {
    m.statusesFindMany.mockResolvedValueOnce([])
    expect(await searchShippedPosts({})).toEqual([])
  })
  it('applies board and query filters', async () => {
    m.statusesFindMany.mockResolvedValueOnce([{ id: 'status_complete' }])
    const res = await searchShippedPosts({ boardId: 'board_1' as never, query: ' Ship ', limit: 5 })
    expect(res).toEqual([{ id: 'post_1' }])
  })
  it('runs without board or query', async () => {
    m.statusesFindMany.mockResolvedValueOnce([{ id: 'status_complete' }])
    expect(await searchShippedPosts({})).toEqual([{ id: 'post_1' }])
  })
})
