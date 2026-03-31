import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HelpCenterCategoryId, HelpCenterArticleId, PrincipalId } from '@quackback/ids'

const insertValuesCalls: unknown[][] = []
const updateSetCalls: unknown[][] = []
const updateWhereCalls: unknown[][] = []

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((...args: unknown[]) => {
    insertValuesCalls.push(args)
    return chain
  })
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'helpcenter_category_new1' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      description: null,
      isPublic: true,
      position: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      deletedAt: null,
    },
  ])
  return chain
}

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.where = vi.fn((...args: unknown[]) => {
    updateWhereCalls.push(args)
    return chain
  })
  chain.returning = vi.fn().mockResolvedValue([
    {
      id: 'helpcenter_category_1' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started Updated',
      description: 'Updated desc',
      isPublic: true,
      position: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
      deletedAt: null,
    },
  ])
  return chain
}

const mockCategoryFindFirst = vi.fn()
const mockCategoryFindMany = vi.fn()
const mockArticleFindFirst = vi.fn()
const mockArticleFindMany = vi.fn()
const mockFeedbackFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockSelectFrom = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      helpCenterCategories: {
        findFirst: (...args: unknown[]) => mockCategoryFindFirst(...args),
        findMany: (...args: unknown[]) => mockCategoryFindMany(...args),
      },
      helpCenterArticles: {
        findFirst: (...args: unknown[]) => mockArticleFindFirst(...args),
        findMany: (...args: unknown[]) => mockArticleFindMany(...args),
      },
      helpCenterArticleFeedback: {
        findFirst: (...args: unknown[]) => mockFeedbackFindFirst(...args),
      },
      principal: {
        findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args),
      },
    },
    insert: vi.fn(() => createInsertChain()),
    update: vi.fn(() => createUpdateChain()),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // The transaction mock delegates to the same db mock so inner queries work
      const self = (await import('@/lib/server/db')).db
      return fn(self)
    }),
    select: vi.fn(() => ({
      from: (...args: unknown[]) => mockSelectFrom(...args),
    })),
  },
  helpCenterCategories: {
    id: 'id',
    slug: 'slug',
    name: 'name',
    deletedAt: 'deleted_at',
    position: 'position',
    isPublic: 'is_public',
  },
  helpCenterArticles: {
    id: 'id',
    slug: 'slug',
    title: 'title',
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
  helpCenterArticleFeedback: {
    id: 'id',
    articleId: 'article_id',
    principalId: 'principal_id',
    helpful: 'helpful',
  },
  principal: { id: 'id', displayName: 'display_name', avatarUrl: 'avatar_url' },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  lte: vi.fn(),
  lt: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: vi.fn(() => ({ type: 'doc', content: [] })),
}))

let listCategories: typeof import('../help-center.service').listCategories
let listPublicCategories: typeof import('../help-center.service').listPublicCategories
let getCategoryById: typeof import('../help-center.service').getCategoryById
let getCategoryBySlug: typeof import('../help-center.service').getCategoryBySlug
let createCategory: typeof import('../help-center.service').createCategory
let _updateCategory: typeof import('../help-center.service').updateCategory
let deleteCategory: typeof import('../help-center.service').deleteCategory
let getArticleById: typeof import('../help-center.service').getArticleById
let createArticle: typeof import('../help-center.service').createArticle
let publishArticle: typeof import('../help-center.service').publishArticle
let unpublishArticle: typeof import('../help-center.service').unpublishArticle
let deleteArticle: typeof import('../help-center.service').deleteArticle
let recordArticleFeedback: typeof import('../help-center.service').recordArticleFeedback

beforeEach(async () => {
  vi.clearAllMocks()
  insertValuesCalls.length = 0
  updateSetCalls.length = 0
  updateWhereCalls.length = 0

  const mod = await import('../help-center.service')
  listCategories = mod.listCategories
  listPublicCategories = mod.listPublicCategories
  getCategoryById = mod.getCategoryById
  getCategoryBySlug = mod.getCategoryBySlug
  createCategory = mod.createCategory
  _updateCategory = mod.updateCategory
  deleteCategory = mod.deleteCategory
  getArticleById = mod.getArticleById
  createArticle = mod.createArticle
  publishArticle = mod.publishArticle
  unpublishArticle = mod.unpublishArticle
  deleteArticle = mod.deleteArticle
  recordArticleFeedback = mod.recordArticleFeedback
})

describe('listCategories', () => {
  it('returns categories with article counts', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'helpcenter_category_1' as HelpCenterCategoryId,
        slug: 'getting-started',
        name: 'Getting Started',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    // Mock the article count query
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([{ categoryId: 'helpcenter_category_1', count: 3 }]),
      }),
    })

    const result = await listCategories()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Getting Started')
    expect(result[0].articleCount).toBe(3)
  })

  it('returns 0 article count when no articles exist', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'helpcenter_category_1' as HelpCenterCategoryId,
        slug: 'empty',
        name: 'Empty',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([]),
      }),
    })

    const result = await listCategories()
    expect(result[0].articleCount).toBe(0)
  })
})

describe('listPublicCategories', () => {
  it('filters to public categories with articles', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'helpcenter_category_1' as HelpCenterCategoryId,
        slug: 'public',
        name: 'Public',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'helpcenter_category_2' as HelpCenterCategoryId,
        slug: 'private',
        name: 'Private',
        description: null,
        isPublic: false,
        position: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([
          { categoryId: 'helpcenter_category_1', count: 2 },
          { categoryId: 'helpcenter_category_2', count: 1 },
        ]),
      }),
    })

    const result = await listPublicCategories()
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('public')
  })
})

describe('getCategoryById', () => {
  it('returns category when found', async () => {
    const mockCat = {
      id: 'helpcenter_category_1' as HelpCenterCategoryId,
      slug: 'test',
      name: 'Test',
      description: null,
      isPublic: true,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockCategoryFindFirst.mockResolvedValue(mockCat)

    const result = await getCategoryById('helpcenter_category_1' as HelpCenterCategoryId)
    expect(result.name).toBe('Test')
  })

  it('throws NotFoundError when category does not exist', async () => {
    mockCategoryFindFirst.mockResolvedValue(null)

    await expect(
      getCategoryById('helpcenter_category_missing' as HelpCenterCategoryId)
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
  })
})

describe('getCategoryBySlug', () => {
  it('returns category by slug', async () => {
    mockCategoryFindFirst.mockResolvedValue({
      id: 'helpcenter_category_1' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      description: null,
      isPublic: true,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await getCategoryBySlug('getting-started')
    expect(result.slug).toBe('getting-started')
  })

  it('throws NotFoundError when slug not found', async () => {
    mockCategoryFindFirst.mockResolvedValue(null)

    await expect(getCategoryBySlug('nonexistent')).rejects.toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
    })
  })
})

describe('createCategory', () => {
  it('creates a category with auto-generated slug', async () => {
    const result = await createCategory({ name: 'Getting Started' })
    expect(result.id).toBeDefined()
    expect(insertValuesCalls).toHaveLength(1)
  })

  it('throws ValidationError when name is empty', async () => {
    await expect(createCategory({ name: '' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('throws ValidationError when name is whitespace only', async () => {
    await expect(createCategory({ name: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })
})

describe('deleteCategory', () => {
  it('soft deletes the category', async () => {
    // updateChain.returning returns non-empty = success
    const result = await deleteCategory('helpcenter_category_1' as HelpCenterCategoryId)
    expect(result).toBeUndefined()
  })

  it('throws NotFoundError when category does not exist', async () => {
    // Override the mock to return empty array
    const { db } = await import('@/lib/server/db')
    const emptyChain: Record<string, unknown> = {}
    emptyChain.set = vi.fn().mockReturnValue(emptyChain)
    emptyChain.where = vi.fn().mockReturnValue(emptyChain)
    emptyChain.returning = vi.fn().mockResolvedValue([])
    vi.mocked(db.update).mockReturnValueOnce(emptyChain as never)

    await expect(
      deleteCategory('helpcenter_category_missing' as HelpCenterCategoryId)
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
  })
})

describe('getArticleById', () => {
  it('returns article with category when found', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'helpcenter_article_1' as HelpCenterArticleId,
      slug: 'how-to-start',
      title: 'How to Start',
      content: 'Content here',
      contentJson: null,
      categoryId: 'helpcenter_category_1',
      principalId: 'principal_1',
      publishedAt: new Date(),
      viewCount: 5,
      helpfulCount: 2,
      notHelpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockCategoryFindFirst.mockResolvedValue({
      id: 'helpcenter_category_1',
      slug: 'getting-started',
      name: 'Getting Started',
    })

    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      displayName: 'Test Author',
      avatarUrl: null,
    })

    const result = await getArticleById('helpcenter_article_1' as HelpCenterArticleId)
    expect(result.title).toBe('How to Start')
    expect(result.category.name).toBe('Getting Started')
    expect(result.author?.name).toBe('Test Author')
  })

  it('throws NotFoundError when article does not exist', async () => {
    mockArticleFindFirst.mockResolvedValue(null)

    await expect(
      getArticleById('helpcenter_article_missing' as HelpCenterArticleId)
    ).rejects.toMatchObject({ code: 'ARTICLE_NOT_FOUND' })
  })
})

describe('createArticle', () => {
  it('creates article with generated slug', async () => {
    // Override insert chain to return article shape
    const { db } = await import('@/lib/server/db')
    const articleInsertChain: Record<string, unknown> = {}
    articleInsertChain.values = vi.fn((...args: unknown[]) => {
      insertValuesCalls.push(args)
      return articleInsertChain
    })
    articleInsertChain.returning = vi.fn().mockResolvedValue([
      {
        id: 'helpcenter_article_new1' as HelpCenterArticleId,
        slug: 'how-to-start',
        title: 'How to Start',
        content: 'Some content',
        contentJson: { type: 'doc', content: [] },
        categoryId: 'helpcenter_category_1',
        principalId: 'principal_1',
        publishedAt: null,
        viewCount: 0,
        helpfulCount: 0,
        notHelpfulCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    vi.mocked(db.insert).mockReturnValueOnce(articleInsertChain as never)

    // Mock category and principal lookups for resolveArticleWithCategory
    mockCategoryFindFirst.mockResolvedValue({
      id: 'helpcenter_category_1',
      slug: 'getting-started',
      name: 'Getting Started',
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      displayName: 'Author',
      avatarUrl: null,
    })

    const result = await createArticle(
      {
        categoryId: 'helpcenter_category_1',
        title: 'How to Start',
        content: 'Some content',
      },
      'principal_1' as PrincipalId
    )

    expect(result.title).toBe('How to Start')
    expect(result.category.name).toBe('Getting Started')
  })

  it('throws ValidationError when title is empty', async () => {
    await expect(
      createArticle(
        { categoryId: 'helpcenter_category_1', title: '', content: 'Content' },
        'principal_1' as PrincipalId
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('throws ValidationError when content is empty', async () => {
    await expect(
      createArticle(
        { categoryId: 'helpcenter_category_1', title: 'Title', content: '' },
        'principal_1' as PrincipalId
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describe('publishArticle', () => {
  it('sets publishedAt to current date', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'helpcenter_article_1' as HelpCenterArticleId,
      slug: 'test',
      title: 'Test',
      content: 'Content',
      contentJson: null,
      categoryId: 'helpcenter_category_1',
      principalId: 'principal_1',
      publishedAt: null,
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockCategoryFindFirst.mockResolvedValue({
      id: 'helpcenter_category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    const result = await publishArticle('helpcenter_article_1' as HelpCenterArticleId)
    expect(result).toBeDefined()
    // Verify update was called (set was called with publishedAt)
    expect(updateSetCalls.length).toBeGreaterThan(0)
  })
})

describe('unpublishArticle', () => {
  it('sets publishedAt to null', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'helpcenter_article_1' as HelpCenterArticleId,
      slug: 'test',
      title: 'Test',
      content: 'Content',
      contentJson: null,
      categoryId: 'helpcenter_category_1',
      principalId: 'principal_1',
      publishedAt: new Date(),
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockCategoryFindFirst.mockResolvedValue({
      id: 'helpcenter_category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    const result = await unpublishArticle('helpcenter_article_1' as HelpCenterArticleId)
    expect(result).toBeDefined()
    expect(updateSetCalls.length).toBeGreaterThan(0)
  })
})

describe('deleteArticle', () => {
  it('soft deletes the article', async () => {
    const result = await deleteArticle('helpcenter_article_1' as HelpCenterArticleId)
    expect(result).toBeUndefined()
  })

  it('throws NotFoundError when article does not exist', async () => {
    const { db } = await import('@/lib/server/db')
    const emptyChain: Record<string, unknown> = {}
    emptyChain.set = vi.fn().mockReturnValue(emptyChain)
    emptyChain.where = vi.fn().mockReturnValue(emptyChain)
    emptyChain.returning = vi.fn().mockResolvedValue([])
    vi.mocked(db.update).mockReturnValueOnce(emptyChain as never)

    await expect(
      deleteArticle('helpcenter_article_missing' as HelpCenterArticleId)
    ).rejects.toMatchObject({ code: 'ARTICLE_NOT_FOUND' })
  })
})

describe('recordArticleFeedback', () => {
  it('inserts new feedback when no existing feedback', async () => {
    // Article exists
    mockArticleFindFirst.mockResolvedValue({
      id: 'helpcenter_article_1' as HelpCenterArticleId,
      slug: 'test',
      title: 'Test',
      content: 'Content',
      contentJson: null,
      categoryId: 'helpcenter_category_1',
      principalId: 'principal_1',
      publishedAt: new Date(),
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // No existing feedback
    mockFeedbackFindFirst.mockResolvedValue(null)

    mockCategoryFindFirst.mockResolvedValue({
      id: 'helpcenter_category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    await recordArticleFeedback(
      'helpcenter_article_1' as HelpCenterArticleId,
      true,
      'principal_1' as PrincipalId
    )

    // Should have inserted feedback + updated article count
    expect(insertValuesCalls.length).toBeGreaterThan(0)
  })

  it('returns early when feedback is unchanged', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'helpcenter_article_1' as HelpCenterArticleId,
      slug: 'test',
      title: 'Test',
      content: 'Content',
      contentJson: null,
      categoryId: 'helpcenter_category_1',
      principalId: 'principal_1',
      publishedAt: new Date(),
      viewCount: 0,
      helpfulCount: 1,
      notHelpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockCategoryFindFirst.mockResolvedValue({
      id: 'helpcenter_category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    // Existing feedback with same value
    mockFeedbackFindFirst.mockResolvedValue({
      id: 'helpcenter_feedback_1',
      articleId: 'helpcenter_article_1',
      principalId: 'principal_1',
      helpful: true,
    })

    await recordArticleFeedback(
      'helpcenter_article_1' as HelpCenterArticleId,
      true, // same as existing
      'principal_1' as PrincipalId
    )

    // Should NOT have inserted new feedback (no change)
    expect(insertValuesCalls).toHaveLength(0)
  })
})
