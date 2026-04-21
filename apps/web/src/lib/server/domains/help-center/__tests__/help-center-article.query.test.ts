import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HelpCenterArticleId } from '@quackback/ids'

const mockArticleFindFirst = vi.fn()
const mockArticleFindMany = vi.fn()
const mockCategoryFindMany = vi.fn()

vi.mock('@/lib/server/db', () => ({
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
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    })),
  },
  helpCenterCategories: { id: 'id', slug: 'slug', name: 'name' },
  helpCenterArticles: {
    id: 'id',
    slug: 'slug',
    title: 'title',
    description: 'description',
    position: 'position',
    content: 'content',
    categoryId: 'category_id',
    deletedAt: 'deleted_at',
    publishedAt: 'published_at',
    createdAt: 'created_at',
    searchVector: 'search_vector',
    viewCount: 'view_count',
    helpfulCount: 'helpful_count',
    notHelpfulCount: 'not_helpful_count',
    principalId: 'principal_id',
  },
  principal: { id: 'id', displayName: 'display_name', avatarUrl: 'avatar_url', role: 'role' },
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

let listArticles: typeof import('../help-center.article.query').listArticles
let listPublicArticlesForCategory: typeof import('../help-center.article.query').listPublicArticlesForCategory

beforeEach(async () => {
  vi.clearAllMocks()

  const mod = await import('../help-center.article.query')
  listArticles = mod.listArticles
  listPublicArticlesForCategory = mod.listPublicArticlesForCategory
})

describe('listPublicArticlesForCategory', () => {
  it('returns published articles for a category ordered by position then publishedAt', async () => {
    const { db } = await import('@/lib/server/db')

    const mockArticles = [
      {
        id: 'article_1' as HelpCenterArticleId,
        slug: 'first-article',
        title: 'First Article',
        description: 'Desc 1',
        position: 0,
        publishedAt: new Date('2024-01-01'),
      },
      {
        id: 'article_2' as HelpCenterArticleId,
        slug: 'second-article',
        title: 'Second Article',
        description: null,
        position: 1,
        publishedAt: new Date('2024-01-02'),
      },
    ]

    const orderByMock = vi.fn().mockResolvedValue(mockArticles)
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock })
    const leftJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    const fromMock = vi.fn().mockReturnValue({ leftJoin: leftJoinMock })
    vi.mocked(db.select).mockReturnValueOnce({ from: fromMock } as never)

    const result = await listPublicArticlesForCategory('category_1')

    expect(result).toHaveLength(2)
    expect(result[0].slug).toBe('first-article')
    expect(result[0].description).toBe('Desc 1')
    expect(result[0].position).toBe(0)
    expect(result[1].slug).toBe('second-article')
    expect(db.select).toHaveBeenCalled()
  })

  it('returns empty array when no published articles exist', async () => {
    const { db } = await import('@/lib/server/db')

    const orderByMock = vi.fn().mockResolvedValue([])
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock })
    const leftJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    const fromMock = vi.fn().mockReturnValue({ leftJoin: leftJoinMock })
    vi.mocked(db.select).mockReturnValueOnce({ from: fromMock } as never)

    const result = await listPublicArticlesForCategory('category_1')
    expect(result).toHaveLength(0)
  })
})

describe('listArticles with showDeleted option', () => {
  it('returns deleted articles within the 30-day window', async () => {
    const recentDeletedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    mockArticleFindMany.mockResolvedValue([
      {
        id: 'article_1' as HelpCenterArticleId,
        slug: 'deleted-article',
        title: 'Deleted Article',
        description: null,
        position: null,
        content: 'Some content',
        categoryId: 'category_1',
        principalId: null,
        publishedAt: null,
        viewCount: 0,
        helpfulCount: 0,
        notHelpfulCount: 0,
        createdAt: new Date('2024-01-01'),
        updatedAt: recentDeletedAt,
        deletedAt: recentDeletedAt,
      },
    ])

    mockCategoryFindMany.mockResolvedValue([{ id: 'category_1', slug: 'cat', name: 'Category' }])

    const result = await listArticles({ showDeleted: true })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe('Deleted Article')
  })

  it('returns live articles by default', async () => {
    mockArticleFindMany.mockResolvedValue([
      {
        id: 'article_2' as HelpCenterArticleId,
        slug: 'live-article',
        title: 'Live Article',
        description: null,
        position: null,
        content: 'Content',
        categoryId: 'category_1',
        principalId: null,
        publishedAt: new Date(),
        viewCount: 0,
        helpfulCount: 0,
        notHelpfulCount: 0,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])

    mockCategoryFindMany.mockResolvedValue([{ id: 'category_1', slug: 'cat', name: 'Category' }])

    const result = await listArticles({})
    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe('Live Article')
  })
})

describe('listArticles sort param', () => {
  function makeArticle(id: string, title: string) {
    return {
      id: id as HelpCenterArticleId,
      slug: id,
      title,
      description: null,
      position: null,
      content: 'Content',
      categoryId: 'category_1',
      principalId: null,
      publishedAt: null,
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      deletedAt: null,
    }
  }

  beforeEach(() => {
    mockCategoryFindMany.mockResolvedValue([{ id: 'category_1', slug: 'cat', name: 'Category' }])
  })

  it('returns articles with sort=newest (default)', async () => {
    const { asc: ascMock, desc: descMock } = await import('@/lib/server/db')
    mockArticleFindMany.mockResolvedValue([makeArticle('article_1', 'Article A')])

    const result = await listArticles({ sort: 'newest' })
    expect(result.items).toHaveLength(1)
    expect(descMock).toHaveBeenCalled()
    expect(ascMock).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'created_at' }))
  })

  it('returns articles with sort=oldest using asc order', async () => {
    const { asc: ascMock } = await import('@/lib/server/db')
    mockArticleFindMany.mockResolvedValue([makeArticle('article_2', 'Article B')])

    const result = await listArticles({ sort: 'oldest' })
    expect(result.items).toHaveLength(1)
    expect(ascMock).toHaveBeenCalled()
  })

  it('defaults to newest when sort is not provided', async () => {
    const { desc: descMock } = await import('@/lib/server/db')
    mockArticleFindMany.mockResolvedValue([makeArticle('article_3', 'Article C')])

    const result = await listArticles({})
    expect(result.items).toHaveLength(1)
    expect(descMock).toHaveBeenCalled()
  })
})
