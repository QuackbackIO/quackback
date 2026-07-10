import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSearchArticleIdsRanked = vi.fn()
vi.mock('../help-center-search.service', () => ({
  searchArticleIdsRanked: (...args: unknown[]) => mockSearchArticleIdsRanked(...args),
  RANKED_SEARCH_POOL: 50,
}))

const mockArticleFindFirst = vi.fn()
const mockArticleFindMany = vi.fn()
const mockCategoryFindMany = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      helpCenterArticles: {
        findFirst: (...args: unknown[]) => mockArticleFindFirst(...args),
        findMany: (...args: unknown[]) => mockArticleFindMany(...args),
      },
      helpCenterCategories: {
        findMany: (...args: unknown[]) => mockCategoryFindMany(...args),
      },
      principal: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  lte: vi.fn(),
  lt: vi.fn(),
  gt: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn(() => {
    const stub: { as: (alias: string) => typeof stub } = { as: () => stub }
    return stub
  }),
  inArray: vi.fn(),
}))

import { listArticles } from '../help-center.article.query'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'

function dbRow(id: string) {
  return {
    id,
    categoryId: 'kb_category_1',
    slug: `slug-${id}`,
    title: `Title ${id}`,
    description: null,
    position: 0,
    content: 'content',
    principalId: null,
    publishedAt: new Date('2024-01-01'),
    viewCount: 0,
    helpfulCount: 0,
    notHelpfulCount: 0,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    deletedAt: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCategoryFindMany.mockResolvedValue([
    { id: 'kb_category_1', slug: 'general', name: 'General' },
  ])
  mockArticleFindMany.mockResolvedValue([])
  mockSearchArticleIdsRanked.mockResolvedValue([])
})

describe('listArticles hybrid search parity', () => {
  it('routes search through the ranked hybrid with team visibility', async () => {
    mockSearchArticleIdsRanked.mockResolvedValue(['kb_article_1'])
    mockArticleFindMany.mockResolvedValue([dbRow('kb_article_1')])

    const result = await listArticles({ search: 'dark mode', status: 'all' })

    expect(mockSearchArticleIdsRanked).toHaveBeenCalledWith('dark mode', {
      audience: 'team',
      viewer: ANONYMOUS_ACTOR,
      categoryId: undefined,
      status: 'all',
      limit: 50,
    })
    expect(result.items.map((i) => i.id)).toEqual(['kb_article_1'])
  })

  it('preserves rank order over db row order', async () => {
    mockSearchArticleIdsRanked.mockResolvedValue(['kb_article_2', 'kb_article_1'])
    // db returns rows in a different order than the ranking
    mockArticleFindMany.mockResolvedValue([dbRow('kb_article_1'), dbRow('kb_article_2')])

    const result = await listArticles({ search: 'q' })
    expect(result.items.map((i) => i.id)).toEqual(['kb_article_2', 'kb_article_1'])
  })

  it('paginates by slicing the ranked pool after the cursor', async () => {
    mockSearchArticleIdsRanked.mockResolvedValue(['kb_article_1', 'kb_article_2', 'kb_article_3'])
    mockArticleFindMany.mockResolvedValue([dbRow('kb_article_2')])

    const result = await listArticles({ search: 'q', cursor: 'kb_article_1', limit: 1 })

    expect(result.items.map((i) => i.id)).toEqual(['kb_article_2'])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('kb_article_2')
  })

  it('returns an empty page for an unknown cursor', async () => {
    mockSearchArticleIdsRanked.mockResolvedValue(['kb_article_1'])
    const result = await listArticles({ search: 'q', cursor: 'kb_article_gone' })
    expect(result.items).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('forwards category and status filters to the ranked search', async () => {
    await listArticles({ search: 'q', categoryId: 'kb_category_7', status: 'draft' })
    expect(mockSearchArticleIdsRanked).toHaveBeenCalledWith('q', {
      audience: 'team',
      viewer: ANONYMOUS_ACTOR,
      categoryId: 'kb_category_7',
      status: 'draft',
      limit: 50,
    })
  })

  it('keeps the legacy path for deleted-item listing with search', async () => {
    mockArticleFindMany.mockResolvedValue([])
    await listArticles({ search: 'q', showDeleted: true })
    expect(mockSearchArticleIdsRanked).not.toHaveBeenCalled()
  })
})
