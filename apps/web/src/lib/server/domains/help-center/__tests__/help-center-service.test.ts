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
    parentId: 'parent_id',
    icon: 'icon',
  },
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
  inArray: vi.fn(),
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: vi.fn(() => ({ type: 'doc', content: [] })),
}))

let listCategories: typeof import('../help-center.service').listCategories
let listPublicCategories: typeof import('../help-center.service').listPublicCategories
let getCategoryById: typeof import('../help-center.service').getCategoryById
let getCategoryBySlug: typeof import('../help-center.service').getCategoryBySlug
let createCategory: typeof import('../help-center.service').createCategory
let updateCategory: typeof import('../help-center.service').updateCategory
let deleteCategory: typeof import('../help-center.service').deleteCategory
let getArticleById: typeof import('../help-center.service').getArticleById
let createArticle: typeof import('../help-center.service').createArticle
let updateArticle: typeof import('../help-center.service').updateArticle
let publishArticle: typeof import('../help-center.service').publishArticle
let unpublishArticle: typeof import('../help-center.service').unpublishArticle
let deleteArticle: typeof import('../help-center.service').deleteArticle
let recordArticleFeedback: typeof import('../help-center.service').recordArticleFeedback
let listPublicArticlesForCategory: typeof import('../help-center.service').listPublicArticlesForCategory

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
  updateCategory = mod.updateCategory
  deleteCategory = mod.deleteCategory
  getArticleById = mod.getArticleById
  createArticle = mod.createArticle
  updateArticle = mod.updateArticle
  publishArticle = mod.publishArticle
  unpublishArticle = mod.unpublishArticle
  deleteArticle = mod.deleteArticle
  recordArticleFeedback = mod.recordArticleFeedback
  listPublicArticlesForCategory = mod.listPublicArticlesForCategory
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
    mockCategoryFindMany.mockResolvedValue([{ id: 'helpcenter_category_1', parentId: null }])
    const result = await deleteCategory('helpcenter_category_1' as HelpCenterCategoryId)
    expect(result).toBeUndefined()
  })

  it('throws NotFoundError when category does not exist', async () => {
    // findMany returns an empty list — category not found before any update
    mockCategoryFindMany.mockResolvedValue([])

    await expect(
      deleteCategory('helpcenter_category_missing' as HelpCenterCategoryId)
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
  })
})

describe('deleteCategory cascade soft-delete', () => {
  it('soft-deletes a leaf category with no descendants', async () => {
    mockCategoryFindMany.mockResolvedValue([{ id: 'leaf', parentId: null }])

    await expect(deleteCategory('leaf' as HelpCenterCategoryId)).resolves.toBeUndefined()
  })

  it('walks descendants and soft-deletes the full subtree including articles', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'a' },
      { id: 'd', parentId: 'b' },
    ])

    await expect(deleteCategory('a' as HelpCenterCategoryId)).resolves.toBeUndefined()

    // inArray is mocked as vi.fn() at the module level; inspect its call history
    // to confirm both the categories update and articles update received all 4 ids.
    const inArrayMock = (await import('@/lib/server/db')).inArray as unknown as ReturnType<
      typeof vi.fn
    >
    const idArrayCalls = inArrayMock.mock.calls
      .map((call) => call[1])
      .filter((arg): arg is string[] => Array.isArray(arg))
    // Find calls where the array contains all four descendant ids
    const fullSubtreeCalls = idArrayCalls.filter(
      (arr) => arr.length === 4 && ['a', 'b', 'c', 'd'].every((id) => arr.includes(id))
    )
    // Expect at least two such calls: one for categories update, one for articles update
    expect(fullSubtreeCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('throws NotFoundError when the category does not exist', async () => {
    mockCategoryFindMany.mockResolvedValue([])
    await expect(deleteCategory('ghost' as HelpCenterCategoryId)).rejects.toThrow(/not found/i)
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

describe('createCategory with parentId and icon', () => {
  it('passes parentId and icon to the database insert', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'helpcenter_category_parent1', parentId: null },
      { id: 'helpcenter_category_1', parentId: null },
    ])
    const result = await createCategory({
      name: 'Child Category',
      parentId: 'helpcenter_category_parent1',
      icon: 'book',
    })
    expect(result.id).toBeDefined()
    expect(insertValuesCalls).toHaveLength(1)
    const insertedValues = insertValuesCalls[0][0] as Record<string, unknown>
    expect(insertedValues.parentId).toBe('helpcenter_category_parent1')
    expect(insertedValues.icon).toBe('book')
  })

  it('defaults parentId and icon to null when not provided', async () => {
    await createCategory({ name: 'Top Level' })
    expect(insertValuesCalls).toHaveLength(1)
    const insertedValues = insertValuesCalls[0][0] as Record<string, unknown>
    expect(insertedValues.parentId).toBeNull()
    expect(insertedValues.icon).toBeNull()
  })
})

describe('updateCategory with parentId and icon', () => {
  it('passes parentId and icon in the update set', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'helpcenter_category_parent1', parentId: null },
      { id: 'helpcenter_category_1', parentId: null },
    ])
    await updateCategory('helpcenter_category_1' as HelpCenterCategoryId, {
      parentId: 'helpcenter_category_parent1',
      icon: 'star',
    })
    expect(updateSetCalls).toHaveLength(1)
    const setValues = updateSetCalls[0][0] as Record<string, unknown>
    expect(setValues.parentId).toBe('helpcenter_category_parent1')
    expect(setValues.icon).toBe('star')
  })

  it('allows clearing parentId and icon by passing null', async () => {
    mockCategoryFindMany.mockResolvedValue([{ id: 'helpcenter_category_1', parentId: null }])
    await updateCategory('helpcenter_category_1' as HelpCenterCategoryId, {
      parentId: null,
      icon: null,
    })
    expect(updateSetCalls).toHaveLength(1)
    const setValues = updateSetCalls[0][0] as Record<string, unknown>
    expect(setValues.parentId).toBeNull()
    expect(setValues.icon).toBeNull()
  })
})

describe('listPublicCategories returns parentId and icon', () => {
  it('includes parentId and icon in results', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'helpcenter_category_1' as HelpCenterCategoryId,
        slug: 'public',
        name: 'Public',
        description: null,
        isPublic: true,
        position: 0,
        parentId: 'helpcenter_category_parent1',
        icon: 'book',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([{ categoryId: 'helpcenter_category_1', count: 2 }]),
      }),
    })

    const result = await listPublicCategories()
    expect(result).toHaveLength(1)
    expect(result[0].parentId).toBe('helpcenter_category_parent1')
    expect(result[0].icon).toBe('book')
  })
})

describe('createArticle with position and description', () => {
  it('passes position and description to the database insert', async () => {
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
        description: 'A short intro',
        position: 5,
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
        position: 5,
        description: 'A short intro',
      },
      'principal_1' as PrincipalId
    )

    expect(result.title).toBe('How to Start')
    const insertedValues = insertValuesCalls[0][0] as Record<string, unknown>
    expect(insertedValues.position).toBe(5)
    expect(insertedValues.description).toBe('A short intro')
  })
})

describe('updateArticle with position and description', () => {
  it('passes position and description in the update set', async () => {
    const { db } = await import('@/lib/server/db')
    const articleUpdateChain: Record<string, unknown> = {}
    articleUpdateChain.set = vi.fn((...args: unknown[]) => {
      updateSetCalls.push(args)
      return articleUpdateChain
    })
    articleUpdateChain.where = vi.fn((...args: unknown[]) => {
      updateWhereCalls.push(args)
      return articleUpdateChain
    })
    articleUpdateChain.returning = vi.fn().mockResolvedValue([
      {
        id: 'helpcenter_article_1' as HelpCenterArticleId,
        slug: 'test',
        title: 'Test',
        description: 'Updated desc',
        position: 3,
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
      },
    ])
    vi.mocked(db.update).mockReturnValueOnce(articleUpdateChain as never)

    mockCategoryFindFirst.mockResolvedValue({
      id: 'helpcenter_category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    await updateArticle('helpcenter_article_1' as HelpCenterArticleId, {
      position: 3,
      description: 'Updated desc',
    })

    expect(updateSetCalls).toHaveLength(1)
    const setValues = updateSetCalls[0][0] as Record<string, unknown>
    expect(setValues.position).toBe(3)
    expect(setValues.description).toBe('Updated desc')
  })
})

describe('listPublicArticlesForCategory', () => {
  it('returns published articles for a category ordered by position then publishedAt', async () => {
    const { db } = await import('@/lib/server/db')

    const mockArticles = [
      {
        id: 'helpcenter_article_1' as HelpCenterArticleId,
        slug: 'first-article',
        title: 'First Article',
        description: 'Desc 1',
        position: 0,
        publishedAt: new Date('2024-01-01'),
      },
      {
        id: 'helpcenter_article_2' as HelpCenterArticleId,
        slug: 'second-article',
        title: 'Second Article',
        description: null,
        position: 1,
        publishedAt: new Date('2024-01-02'),
      },
    ]

    // Mock the select().from().where().orderBy() chain
    const orderByMock = vi.fn().mockResolvedValue(mockArticles)
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock })
    const fromMock = vi.fn().mockReturnValue({ where: whereMock })
    const selectResult = { from: fromMock }
    vi.mocked(db.select).mockReturnValueOnce(selectResult as never)

    const result = await listPublicArticlesForCategory('helpcenter_category_1')

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
    const fromMock = vi.fn().mockReturnValue({ where: whereMock })
    vi.mocked(db.select).mockReturnValueOnce({ from: fromMock } as never)

    const result = await listPublicArticlesForCategory('helpcenter_category_1')
    expect(result).toHaveLength(0)
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

describe('createCategory hierarchy validation', () => {
  it('rejects a parentId that already sits at the maximum depth', async () => {
    // parent 'c' is at depth 2 (a -> b -> c); adding a child would make depth 3
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ])
    await expect(createCategory({ name: 'Too Deep', parentId: 'c' })).rejects.toThrow(/depth/i)
  })

  it('allows a parentId at depth 1 (new category would land at depth 2)', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ])
    await expect(createCategory({ name: 'OK', parentId: 'b' })).resolves.toBeDefined()
  })

  it('allows a null parentId (new top-level category)', async () => {
    await expect(createCategory({ name: 'Top' })).resolves.toBeDefined()
  })

  it('rejects a parentId that does not exist', async () => {
    mockCategoryFindMany.mockResolvedValue([])
    await expect(createCategory({ name: 'Orphan', parentId: 'ghost' })).rejects.toThrow(
      /not found/i
    )
  })
})

describe('updateCategory hierarchy validation', () => {
  it('rejects moving a category under itself', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ])
    await expect(updateCategory('a' as HelpCenterCategoryId, { parentId: 'a' })).rejects.toThrow(
      /parent/i
    )
  })

  it('rejects moving a category under its own descendant', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ])
    // Moving 'a' under 'c' would create a cycle
    await expect(updateCategory('a' as HelpCenterCategoryId, { parentId: 'c' })).rejects.toThrow(
      /cycle/i
    )
  })

  it('rejects moving a subtree such that the deepest leaf would exceed MAX_CATEGORY_DEPTH', async () => {
    // Tree:
    //   a (depth 0)
    //     b (depth 1)
    //       c (depth 2)
    //   x (depth 0)
    //     y (depth 1)
    // Moving 'b' (subtree height 1) under 'y' (depth 1) would put b at depth 2 and c at depth 3
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'x', parentId: null },
      { id: 'y', parentId: 'x' },
    ])
    await expect(updateCategory('b' as HelpCenterCategoryId, { parentId: 'y' })).rejects.toThrow(
      /depth/i
    )
  })

  it('allows setting parentId to null (promoting to top-level)', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ])
    await expect(
      updateCategory('b' as HelpCenterCategoryId, { parentId: null })
    ).resolves.toBeDefined()
  })
})
