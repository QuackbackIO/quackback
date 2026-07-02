/**
 * Differential-coverage tests for changelog.public — public meta/detail lookups
 * (visibility filter, view-count fire-and-forget, linked-post + status +
 * category/product enrichment) and the listPublicChangelogs filter/visibility/
 * cursor/pagination matrix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  entriesFindFirst: vi.fn(),
  entriesFindMany: vi.fn(),
  statusesFindMany: vi.fn(),
  categoriesFindFirst: vi.fn(),
  categoriesFindMany: vi.fn(),
  productsFindFirst: vi.fn(),
  productsFindMany: vi.fn(),
  linkedSelect: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      changelogEntries: { findFirst: m.entriesFindFirst, findMany: m.entriesFindMany },
      postStatuses: { findMany: m.statusesFindMany },
      changelogCategories: { findFirst: m.categoriesFindFirst, findMany: m.categoriesFindMany },
      changelogProducts: { findFirst: m.productsFindFirst, findMany: m.productsFindMany },
    },
    select: () => ({
      from: () => ({ innerJoin: () => ({ innerJoin: () => ({ where: () => m.linkedSelect() }) }) }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
  changelogCategories: { id: 'cc.id' },
  changelogEntries: {
    id: 'ce.id',
    deletedAt: 'ce.deletedAt',
    publishedAt: 'ce.publishedAt',
    categoryId: 'ce.categoryId',
    productId: 'ce.productId',
    viewCount: 'ce.viewCount',
  },
  changelogEntryPosts: { changelogEntryId: 'cep.entryId', postId: 'cep.postId' },
  changelogProducts: { id: 'cp.id' },
  postStatuses: { id: 'ps.id' },
  posts: {
    id: 'p.id',
    boardId: 'p.boardId',
    deletedAt: 'p.deletedAt',
    moderationState: 'p.moderationState',
  },
  boards: { id: 'b.id', deletedAt: 'b.deletedAt', access: 'b.access' },
  eq: vi.fn(),
  and: vi.fn((...a) => ({ and: a })),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  lt: vi.fn(),
  lte: vi.fn(),
  or: vi.fn((...a) => ({ or: a })),
  desc: vi.fn(),
  inArray: vi.fn(),
  sql: (..._a: unknown[]) => ({ __sql: true }),
}))

vi.mock('../changelog.service', () => ({ computeStatus: vi.fn() }))

import {
  publicChangelogConditions,
  getPublicChangelogMetaById,
  getPublicChangelogById,
  listPublicChangelogs,
} from '../changelog.public'

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'cl_1',
  title: 'Release',
  content: 'c',
  contentJson: null,
  publishedAt: new Date('2026-01-01'),
  categoryId: null,
  productId: null,
  ...over,
})
const linkedPost = (over: Record<string, unknown> = {}) => ({
  changelogEntryId: 'cl_1',
  postId: 'post_1',
  postTitle: 'P',
  postVoteCount: 3,
  postStatusId: 'status_1',
  boardId: 'board_1',
  boardSlug: 'b',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.entriesFindFirst.mockResolvedValue(undefined)
  m.entriesFindMany.mockResolvedValue([])
  m.statusesFindMany.mockResolvedValue([])
  m.categoriesFindFirst.mockResolvedValue(null)
  m.categoriesFindMany.mockResolvedValue([])
  m.productsFindFirst.mockResolvedValue(null)
  m.productsFindMany.mockResolvedValue([])
  m.linkedSelect.mockResolvedValue([])
})

describe('publicChangelogConditions', () => {
  it('returns the three visibility predicates', () => {
    expect(publicChangelogConditions(new Date())).toHaveLength(3)
  })
})

describe('getPublicChangelogMetaById', () => {
  it('returns slim meta when visible', async () => {
    m.entriesFindFirst.mockResolvedValueOnce({
      id: 'cl_1',
      title: 'T',
      publishedAt: new Date('2026-01-01'),
    })
    expect(await getPublicChangelogMetaById('cl_1' as never)).toMatchObject({
      id: 'cl_1',
      title: 'T',
    })
  })
  it('returns null when not visible', async () => {
    m.entriesFindFirst.mockResolvedValueOnce(undefined)
    expect(await getPublicChangelogMetaById('cl_1' as never)).toBeNull()
  })
})

describe('getPublicChangelogById', () => {
  it('throws when not published/visible', async () => {
    m.entriesFindFirst.mockResolvedValueOnce(undefined)
    await expect(getPublicChangelogById('cl_1' as never)).rejects.toThrow('not found')
  })
  it('returns the entry with linked posts, statuses, category and product', async () => {
    m.entriesFindFirst.mockResolvedValueOnce(entry({ categoryId: 'cat_1', productId: 'prod_1' }))
    m.linkedSelect.mockResolvedValueOnce([
      linkedPost(),
      linkedPost({ postId: 'post_2', postStatusId: null }),
    ])
    m.statusesFindMany.mockResolvedValueOnce([{ id: 'status_1', name: 'Done', color: '#0f0' }])
    m.categoriesFindFirst.mockResolvedValueOnce({
      id: 'cat_1',
      name: 'Cat',
      slug: 'cat',
      color: '#00f',
    })
    m.productsFindFirst.mockResolvedValueOnce({ id: 'prod_1', name: 'Prod', slug: 'prod' })
    const res = await getPublicChangelogById('cl_1' as never)
    expect(res.linkedPosts).toHaveLength(2)
    expect(res.linkedPosts[0].status).toMatchObject({ name: 'Done' })
    expect(res.linkedPosts[1].status).toBeNull()
    expect(res.category).toMatchObject({ name: 'Cat' })
    expect(res.product).toMatchObject({ name: 'Prod' })
  })
  it('returns null category/product when the entry has none', async () => {
    m.entriesFindFirst.mockResolvedValueOnce(entry())
    const res = await getPublicChangelogById('cl_1' as never)
    expect(res.category).toBeNull()
    expect(res.product).toBeNull()
  })
})

describe('listPublicChangelogs', () => {
  it('short-circuits on empty entryIds / categoryIds / productIds', async () => {
    expect(await listPublicChangelogs({ entryIds: [] })).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
    expect(await listPublicChangelogs({ categoryIds: [] })).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
    expect(await listPublicChangelogs({ productIds: [] })).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    })
  })

  it('applies all filters + visibility + cursor and paginates with hasMore', async () => {
    m.entriesFindFirst.mockResolvedValueOnce({ publishedAt: new Date('2026-02-01') }) // cursor lookup
    m.entriesFindMany.mockResolvedValueOnce([
      entry({ id: 'cl_1', categoryId: 'cat_1', productId: 'prod_1' }),
      entry({ id: 'cl_2' }),
    ])
    m.linkedSelect.mockResolvedValueOnce([linkedPost({ changelogEntryId: 'cl_1' })])
    m.statusesFindMany.mockResolvedValueOnce([{ id: 'status_1', name: 'Done', color: '#0f0' }])
    m.categoriesFindMany.mockResolvedValueOnce([
      { id: 'cat_1', name: 'Cat', slug: 'cat', color: '#00f' },
    ])
    m.productsFindMany.mockResolvedValueOnce([{ id: 'prod_1', name: 'Prod', slug: 'prod' }])
    const res = await listPublicChangelogs({
      entryIds: ['cl_1', 'cl_2'] as never,
      categoryIds: ['cat_1'] as never,
      productIds: ['prod_1'] as never,
      visibilityCategoryIds: ['cat_1'] as never,
      visibilityProductIds: ['prod_1'] as never,
      cursor: 'cursor_1',
      limit: 1,
    })
    expect(res.hasMore).toBe(true)
    expect(res.items).toHaveLength(1)
    expect(res.nextCursor).toBe('cl_1')
    expect(res.items[0].linkedPosts[0].status).toMatchObject({ name: 'Done' })
  })

  it('runs unfiltered (no visibility restriction, no cursor row) with no entries', async () => {
    m.entriesFindFirst.mockResolvedValueOnce(undefined) // cursor lookup misses
    m.entriesFindMany.mockResolvedValueOnce([])
    const res = await listPublicChangelogs({
      visibilityCategoryIds: null,
      visibilityProductIds: null,
      cursor: 'x',
    })
    expect(res).toEqual({ items: [], nextCursor: null, hasMore: false })
  })
})
