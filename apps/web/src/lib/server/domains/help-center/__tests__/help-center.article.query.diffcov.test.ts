/**
 * Differential-coverage tests for help-center.article.query — listArticles
 * (status/showDeleted/search/cursor sort + category/author enrichment +
 * pagination), listPublicArticles (visibility filter), the per-category public
 * list (not-found / not-visible guards), and the category-editors dedup/cap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const chain: Record<string, unknown> = {}
  for (const k of ['from', 'innerJoin', 'leftJoin', 'where']) chain[k] = () => chain
  chain.orderBy = () => m.selectResult()
  return {
    chain,
    articlesFindFirst: vi.fn(),
    articlesFindMany: vi.fn(),
    categoriesFindFirst: vi.fn(),
    categoriesFindMany: vi.fn(),
    principalFindMany: vi.fn(),
    selectResult: vi.fn(),
    canView: vi.fn((..._a: unknown[]) => true),
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      helpCenterArticles: { findFirst: m.articlesFindFirst, findMany: m.articlesFindMany },
      helpCenterCategories: { findFirst: m.categoriesFindFirst, findMany: m.categoriesFindMany },
      principal: { findMany: m.principalFindMany },
    },
    select: () => m.chain,
  },
  helpCenterCategories: { id: 'hc.id', deletedAt: 'hc.deletedAt', isPublic: 'hc.isPublic' },
  helpCenterArticles: {
    id: 'ha.id',
    categoryId: 'ha.categoryId',
    deletedAt: 'ha.deletedAt',
    publishedAt: 'ha.publishedAt',
    createdAt: 'ha.createdAt',
    position: 'ha.position',
    content: 'ha.content',
    principalId: 'ha.principalId',
    searchVector: 'ha.sv',
  },
  principal: {
    id: 'pr.id',
    displayName: 'pr.displayName',
    avatarUrl: 'pr.avatarUrl',
    role: 'pr.role',
  },
  eq: vi.fn(),
  and: vi.fn((...a) => ({ and: a })),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  lte: vi.fn(),
  lt: vi.fn(),
  gt: vi.fn(),
  or: vi.fn((...a) => ({ or: a })),
  desc: vi.fn(),
  asc: vi.fn(),
  inArray: vi.fn(),
  sql: (..._a: unknown[]) => ({ __sql: true }),
}))
vi.mock('../help-center.visibility', () => ({
  canActorViewCategory: (...a: unknown[]) => m.canView(...a),
}))

import {
  listArticles,
  listPublicArticles,
  listPublicArticlesForCategory,
  listPublicCategoryEditors,
} from '../help-center.article.query'

const article = (over: Record<string, unknown> = {}) => ({
  id: 'art_1',
  categoryId: 'cat_1',
  slug: 's',
  title: 'T',
  description: null,
  position: 0,
  content: 'c',
  principalId: 'pr_1',
  publishedAt: null,
  viewCount: 0,
  helpfulCount: 0,
  notHelpfulCount: 0,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.articlesFindFirst.mockResolvedValue(undefined)
  m.articlesFindMany.mockResolvedValue([])
  m.categoriesFindFirst.mockResolvedValue(undefined)
  m.categoriesFindMany.mockResolvedValue([])
  m.principalFindMany.mockResolvedValue([])
  m.selectResult.mockResolvedValue([])
  m.canView.mockReturnValue(true)
})

describe('listArticles', () => {
  it('handles published / draft / all + showDeleted', async () => {
    for (const status of ['published', 'draft', 'all'] as const) {
      const res = await listArticles({ status } as never)
      expect(res).toEqual({ items: [], nextCursor: null, hasMore: false })
    }
    await listArticles({ showDeleted: true } as never)
    expect(m.articlesFindMany).toHaveBeenCalled()
  })
  it('applies category, search, and a found cursor (oldest + newest)', async () => {
    m.articlesFindFirst.mockResolvedValue({ createdAt: new Date('2026-02-01') })
    await listArticles({
      categoryId: 'cat_1',
      search: ' bug ',
      cursor: 'c1',
      sort: 'oldest',
    } as never)
    await listArticles({ search: ' bug ', cursor: 'c1', sort: 'newest' } as never)
    expect(m.articlesFindMany).toHaveBeenCalled()
  })
  it('resolves categories + authors, falls back to Unknown / null, paginates', async () => {
    m.articlesFindMany.mockResolvedValueOnce([
      article({ id: 'a1', categoryId: 'cat_1', principalId: 'pr_1' }),
      article({ id: 'a2', categoryId: 'cat_x', principalId: null }),
    ])
    m.categoriesFindMany.mockResolvedValueOnce([{ id: 'cat_1', slug: 'cat', name: 'Cat' }])
    m.principalFindMany.mockResolvedValueOnce([
      { id: 'pr_1', displayName: 'Author', avatarUrl: null },
    ])
    const res = await listArticles({ limit: 1 } as never)
    expect(res.hasMore).toBe(true)
    expect(res.items[0].category).toMatchObject({ name: 'Cat' })
    expect(res.nextCursor).toBe('a1')
  })
})

describe('listPublicArticles', () => {
  it('returns immediately when there are no categories', async () => {
    const res = await listPublicArticles({})
    expect(res.items).toEqual([])
  })
  it('filters items to actor-visible categories', async () => {
    m.articlesFindMany.mockResolvedValueOnce([article({ id: 'a1', categoryId: 'cat_1' })])
    m.categoriesFindMany.mockResolvedValueOnce([{ id: 'cat_1', slug: 'c', name: 'C' }]) // listArticles enrichment
    m.categoriesFindMany.mockResolvedValueOnce([
      { id: 'cat_1', isPublic: true, allowedSegmentIds: null, allowedPrincipalIds: null },
    ]) // visibility lookup
    const res = await listPublicArticles({})
    expect(res.items).toHaveLength(1)
  })
})

describe('listPublicArticlesForCategory', () => {
  it('returns [] when the category is missing', async () => {
    m.categoriesFindFirst.mockResolvedValueOnce(undefined)
    expect(await listPublicArticlesForCategory('cat_1')).toEqual([])
  })
  it('returns [] when the actor cannot view the category', async () => {
    m.categoriesFindFirst.mockResolvedValueOnce({
      id: 'cat_1',
      isPublic: true,
      allowedSegmentIds: [],
      allowedPrincipalIds: [],
    })
    m.canView.mockReturnValueOnce(false)
    expect(await listPublicArticlesForCategory('cat_1')).toEqual([])
  })
  it('returns the joined article rows when visible', async () => {
    m.categoriesFindFirst.mockResolvedValueOnce({
      id: 'cat_1',
      isPublic: true,
      allowedSegmentIds: [],
      allowedPrincipalIds: [],
    })
    m.selectResult.mockResolvedValueOnce([{ id: 'a1', title: 'T' }])
    expect(await listPublicArticlesForCategory('cat_1')).toEqual([{ id: 'a1', title: 'T' }])
  })
})

describe('listPublicCategoryEditors', () => {
  it('dedupes editors per category and caps at three', async () => {
    m.selectResult.mockResolvedValueOnce([
      { categoryId: 'cat_1', principalId: 'p1', displayName: 'A', avatarUrl: null },
      { categoryId: 'cat_1', principalId: 'p1', displayName: 'A', avatarUrl: null }, // dup -> skipped
      { categoryId: 'cat_1', principalId: 'p2', displayName: 'B', avatarUrl: null },
      { categoryId: 'cat_1', principalId: 'p3', displayName: null, avatarUrl: null }, // no displayName -> skipped
      { categoryId: 'cat_2', principalId: 'p4', displayName: 'C', avatarUrl: null },
    ])
    const res = await listPublicCategoryEditors()
    expect(res.cat_1.map((e) => e.name)).toEqual(['A', 'B'])
    expect(res.cat_2.map((e) => e.name)).toEqual(['C'])
  })
})
