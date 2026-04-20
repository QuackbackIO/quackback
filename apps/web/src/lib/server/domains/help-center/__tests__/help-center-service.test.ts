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
      id: 'category_new1' as HelpCenterCategoryId,
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
      id: 'category_1' as HelpCenterCategoryId,
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
  gt: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn(() => {
    // Return a chainable stub so `sql\`...\`.as('x')` works under mocks.
    // Real SQL execution is exercised in integration tests, not here.
    const stub: { as: (alias: string) => typeof stub } = {
      as: () => stub,
    }
    return stub
  }),
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
let restoreCategory: typeof import('../help-center.service').restoreCategory
let getArticleById: typeof import('../help-center.service').getArticleById
let createArticle: typeof import('../help-center.service').createArticle
let updateArticle: typeof import('../help-center.service').updateArticle
let publishArticle: typeof import('../help-center.service').publishArticle
let unpublishArticle: typeof import('../help-center.service').unpublishArticle
let deleteArticle: typeof import('../help-center.service').deleteArticle
let restoreArticle: typeof import('../help-center.service').restoreArticle
let recordArticleFeedback: typeof import('../help-center.service').recordArticleFeedback
let listPublicArticlesForCategory: typeof import('../help-center.service').listPublicArticlesForCategory
let listArticles: typeof import('../help-center.service').listArticles

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
  restoreCategory = mod.restoreCategory
  getArticleById = mod.getArticleById
  createArticle = mod.createArticle
  updateArticle = mod.updateArticle
  publishArticle = mod.publishArticle
  unpublishArticle = mod.unpublishArticle
  deleteArticle = mod.deleteArticle
  restoreArticle = mod.restoreArticle
  recordArticleFeedback = mod.recordArticleFeedback
  listPublicArticlesForCategory = mod.listPublicArticlesForCategory
  listArticles = mod.listArticles
})

describe('listCategories', () => {
  it('returns categories with article counts', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
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
        groupBy: vi
          .fn()
          .mockResolvedValue([{ categoryId: 'category_1', totalCount: 3, publishedCount: 3 }]),
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
        id: 'category_1' as HelpCenterCategoryId,
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

  it('rolls descendant counts up into parent recursiveArticleCount', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_parent' as HelpCenterCategoryId,
        parentId: null,
        slug: 'parent',
        name: 'Parent',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'category_child' as HelpCenterCategoryId,
        parentId: 'category_parent' as HelpCenterCategoryId,
        slug: 'child',
        name: 'Child',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    // Parent has zero direct articles; child has 3 published + 1 draft.
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi
          .fn()
          .mockResolvedValue([{ categoryId: 'category_child', totalCount: 4, publishedCount: 3 }]),
      }),
    })

    const result = await listCategories()
    const parent = result.find((c) => c.id === 'category_parent')!
    const child = result.find((c) => c.id === 'category_child')!

    expect(parent.articleCount).toBe(0)
    expect(parent.publishedArticleCount).toBe(0)
    expect(parent.recursiveArticleCount).toBe(4)
    expect(parent.recursivePublishedArticleCount).toBe(3)

    expect(child.articleCount).toBe(4)
    expect(child.recursiveArticleCount).toBe(4)
    expect(child.publishedArticleCount).toBe(3)
    expect(child.recursivePublishedArticleCount).toBe(3)
  })
})

describe('listPublicCategories', () => {
  it('filters to public categories with articles', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'public',
        name: 'Public',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'category_2' as HelpCenterCategoryId,
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
          { categoryId: 'category_1', totalCount: 2, publishedCount: 2 },
          { categoryId: 'category_2', totalCount: 1, publishedCount: 1 },
        ]),
      }),
    })

    const result = await listPublicCategories()
    expect(result).toHaveLength(1)
    expect(result[0].slug).toBe('public')
  })

  it('includes a parent category whose only published articles live under children', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_parent' as HelpCenterCategoryId,
        parentId: null,
        slug: 'parent',
        name: 'Parent',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'category_child' as HelpCenterCategoryId,
        parentId: 'category_parent' as HelpCenterCategoryId,
        slug: 'child',
        name: 'Child',
        description: null,
        isPublic: true,
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'category_empty_root' as HelpCenterCategoryId,
        parentId: null,
        slug: 'empty',
        name: 'Empty Root',
        description: null,
        isPublic: true,
        position: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi
          .fn()
          .mockResolvedValue([
            { categoryId: 'category_child', totalCount: 14, publishedCount: 14 },
          ]),
      }),
    })

    const result = await listPublicCategories()
    const slugs = result.map((c) => c.slug).sort()
    expect(slugs).toEqual(['child', 'parent'])

    const parent = result.find((c) => c.slug === 'parent')!
    expect(parent.articleCount).toBe(14)
  })
})

describe('getCategoryById', () => {
  it('returns category when found', async () => {
    const mockCat = {
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'test',
      name: 'Test',
      description: null,
      isPublic: true,
      position: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockCategoryFindFirst.mockResolvedValue(mockCat)

    const result = await getCategoryById('category_1' as HelpCenterCategoryId)
    expect(result.name).toBe('Test')
  })

  it('throws NotFoundError when category does not exist', async () => {
    mockCategoryFindFirst.mockResolvedValue(null)

    await expect(getCategoryById('category_missing' as HelpCenterCategoryId)).rejects.toMatchObject(
      { code: 'CATEGORY_NOT_FOUND' }
    )
  })
})

describe('getCategoryBySlug', () => {
  it('returns category by slug', async () => {
    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1' as HelpCenterCategoryId,
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
    mockCategoryFindMany.mockResolvedValue([{ id: 'category_1', parentId: null }])
    const result = await deleteCategory('category_1' as HelpCenterCategoryId)
    expect(result).toBeUndefined()
  })

  it('throws NotFoundError when category does not exist', async () => {
    // findMany returns an empty list — category not found before any update
    mockCategoryFindMany.mockResolvedValue([])

    await expect(deleteCategory('category_missing' as HelpCenterCategoryId)).rejects.toMatchObject({
      code: 'CATEGORY_NOT_FOUND',
    })
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
      id: 'article_1' as HelpCenterArticleId,
      slug: 'how-to-start',
      title: 'How to Start',
      content: 'Content here',
      contentJson: null,
      categoryId: 'category_1',
      principalId: 'principal_1',
      publishedAt: new Date(),
      viewCount: 5,
      helpfulCount: 2,
      notHelpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1',
      slug: 'getting-started',
      name: 'Getting Started',
    })

    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      displayName: 'Test Author',
      avatarUrl: null,
    })

    const result = await getArticleById('article_1' as HelpCenterArticleId)
    expect(result.title).toBe('How to Start')
    expect(result.category.name).toBe('Getting Started')
    expect(result.author?.name).toBe('Test Author')
  })

  it('throws NotFoundError when article does not exist', async () => {
    mockArticleFindFirst.mockResolvedValue(null)

    await expect(getArticleById('article_missing' as HelpCenterArticleId)).rejects.toMatchObject({
      code: 'ARTICLE_NOT_FOUND',
    })
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
        id: 'article_new1' as HelpCenterArticleId,
        slug: 'how-to-start',
        title: 'How to Start',
        content: 'Some content',
        contentJson: { type: 'doc', content: [] },
        categoryId: 'category_1',
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
      id: 'category_1',
      slug: 'getting-started',
      name: 'Getting Started',
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      displayName: 'Author',
      avatarUrl: null,
      type: 'user',
    })

    const result = await createArticle(
      {
        categoryId: 'category_1',
        title: 'How to Start',
        content: 'Some content',
      },
      'principal_1' as PrincipalId
    )

    expect(result.title).toBe('How to Start')
    expect(result.category.name).toBe('Getting Started')
  })

  it('throws ValidationError when the calling principal is a service principal and no authorId is given', async () => {
    // Service API key has no human identity; caller must supply an explicit authorId
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_svc', type: 'service' })
    await expect(
      createArticle(
        { categoryId: 'category_1', title: 'Title', content: 'Content' },
        'principal_svc' as PrincipalId
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('throws ValidationError when title is empty', async () => {
    await expect(
      createArticle(
        { categoryId: 'category_1', title: '', content: 'Content' },
        'principal_1' as PrincipalId
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('throws ValidationError when content is empty', async () => {
    await expect(
      createArticle(
        { categoryId: 'category_1', title: 'Title', content: '' },
        'principal_1' as PrincipalId
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('throws ValidationError when authorId is a non-member principal', async () => {
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_portal', role: 'user', type: 'user' })
    await expect(
      createArticle(
        { categoryId: 'category_1', title: 'Title', content: 'Content' },
        'principal_admin' as PrincipalId,
        'principal_portal' as PrincipalId
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('throws ValidationError when authorId is a service principal', async () => {
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_svc', role: 'admin', type: 'service' })
    await expect(
      createArticle(
        { categoryId: 'category_1', title: 'Title', content: 'Content' },
        'principal_admin' as PrincipalId,
        'principal_svc' as PrincipalId
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('accepts a member-role authorId', async () => {
    // findFirst for authorId check → member principal
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_member', role: 'member', type: 'user' })
    // Second call is from resolveArticleWithCategory
    mockCategoryFindFirst.mockResolvedValue({ id: 'category_1', slug: 'cat', name: 'Cat' })
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_member', displayName: 'Jane', avatarUrl: null })

    const { db } = await import('@/lib/server/db')
    const chain: Record<string, unknown> = {}
    chain.values = vi.fn(() => chain)
    chain.returning = vi.fn().mockResolvedValue([{
      id: 'article_new' as HelpCenterArticleId,
      slug: 'title', title: 'Title', content: 'Content',
      contentJson: null, categoryId: 'category_1',
      principalId: 'principal_member', publishedAt: null,
      viewCount: 0, helpfulCount: 0, notHelpfulCount: 0,
      createdAt: new Date(), updatedAt: new Date(),
    }])
    vi.mocked(db.insert).mockReturnValueOnce(chain as never)

    await expect(
      createArticle(
        { categoryId: 'category_1', title: 'Title', content: 'Content' },
        'principal_admin' as PrincipalId,
        'principal_member' as PrincipalId
      )
    ).resolves.toBeDefined()
  })
})

describe('publishArticle', () => {
  it('sets publishedAt to current date', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'article_1' as HelpCenterArticleId,
      slug: 'test',
      title: 'Test',
      content: 'Content',
      contentJson: null,
      categoryId: 'category_1',
      principalId: 'principal_1',
      publishedAt: null,
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    const result = await publishArticle('article_1' as HelpCenterArticleId)
    expect(result).toBeDefined()
    // Verify update was called (set was called with publishedAt)
    expect(updateSetCalls.length).toBeGreaterThan(0)
  })
})

describe('unpublishArticle', () => {
  it('sets publishedAt to null', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'article_1' as HelpCenterArticleId,
      slug: 'test',
      title: 'Test',
      content: 'Content',
      contentJson: null,
      categoryId: 'category_1',
      principalId: 'principal_1',
      publishedAt: new Date(),
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    const result = await unpublishArticle('article_1' as HelpCenterArticleId)
    expect(result).toBeDefined()
    expect(updateSetCalls.length).toBeGreaterThan(0)
  })
})

describe('deleteArticle', () => {
  it('soft deletes the article', async () => {
    const result = await deleteArticle('article_1' as HelpCenterArticleId)
    expect(result).toBeUndefined()
  })

  it('throws NotFoundError when article does not exist', async () => {
    const { db } = await import('@/lib/server/db')
    const emptyChain: Record<string, unknown> = {}
    emptyChain.set = vi.fn().mockReturnValue(emptyChain)
    emptyChain.where = vi.fn().mockReturnValue(emptyChain)
    emptyChain.returning = vi.fn().mockResolvedValue([])
    vi.mocked(db.update).mockReturnValueOnce(emptyChain as never)

    await expect(deleteArticle('article_missing' as HelpCenterArticleId)).rejects.toMatchObject({
      code: 'ARTICLE_NOT_FOUND',
    })
  })
})

describe('createCategory with parentId and icon', () => {
  it('passes parentId and icon to the database insert', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'category_parent1', parentId: null },
      { id: 'category_1', parentId: null },
    ])
    const result = await createCategory({
      name: 'Child Category',
      parentId: 'category_parent1',
      icon: 'book',
    })
    expect(result.id).toBeDefined()
    expect(insertValuesCalls).toHaveLength(1)
    const insertedValues = insertValuesCalls[0][0] as Record<string, unknown>
    expect(insertedValues.parentId).toBe('category_parent1')
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
      { id: 'category_parent1', parentId: null },
      { id: 'category_1', parentId: null },
    ])
    await updateCategory('category_1' as HelpCenterCategoryId, {
      parentId: 'category_parent1',
      icon: 'star',
    })
    expect(updateSetCalls).toHaveLength(1)
    const setValues = updateSetCalls[0][0] as Record<string, unknown>
    expect(setValues.parentId).toBe('category_parent1')
    expect(setValues.icon).toBe('star')
  })

  it('allows clearing parentId and icon by passing null', async () => {
    mockCategoryFindMany.mockResolvedValue([{ id: 'category_1', parentId: null }])
    await updateCategory('category_1' as HelpCenterCategoryId, {
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
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'public',
        name: 'Public',
        description: null,
        isPublic: true,
        position: 0,
        parentId: 'category_parent1',
        icon: 'book',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi
          .fn()
          .mockResolvedValue([{ categoryId: 'category_1', totalCount: 2, publishedCount: 2 }]),
      }),
    })

    const result = await listPublicCategories()
    expect(result).toHaveLength(1)
    expect(result[0].parentId).toBe('category_parent1')
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
        id: 'article_new1' as HelpCenterArticleId,
        slug: 'how-to-start',
        title: 'How to Start',
        description: 'A short intro',
        position: 5,
        content: 'Some content',
        contentJson: { type: 'doc', content: [] },
        categoryId: 'category_1',
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
      id: 'category_1',
      slug: 'getting-started',
      name: 'Getting Started',
    })
    mockPrincipalFindFirst.mockResolvedValue({
      id: 'principal_1',
      displayName: 'Author',
      avatarUrl: null,
      type: 'user',
    })

    const result = await createArticle(
      {
        categoryId: 'category_1',
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

describe('updateArticle authorId validation', () => {
  it('throws ValidationError when authorId is a non-member principal', async () => {
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_portal', role: 'user', type: 'user' })
    await expect(
      updateArticle('article_1' as HelpCenterArticleId, {}, 'principal_portal' as PrincipalId)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('throws ValidationError when authorId is a service principal', async () => {
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_svc', role: 'member', type: 'service' })
    await expect(
      updateArticle('article_1' as HelpCenterArticleId, {}, 'principal_svc' as PrincipalId)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('allows re-asserting a former-member as author when they already own the article', async () => {
    // Former member is the existing article's author — preserving attribution is fine
    mockArticleFindFirst.mockResolvedValueOnce({ id: 'article_1', principalId: 'principal_former' })
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_former', role: 'user', type: 'user' })

    const { db } = await import('@/lib/server/db')
    const chain: Record<string, unknown> = {}
    chain.set = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.returning = vi.fn().mockResolvedValue([{
      id: 'article_1' as HelpCenterArticleId,
      slug: 'test', title: 'Test', content: 'Content',
      contentJson: null, categoryId: 'category_1',
      principalId: 'principal_former', publishedAt: null,
      viewCount: 0, helpfulCount: 0, notHelpfulCount: 0,
      createdAt: new Date(), updatedAt: new Date(),
    }])
    vi.mocked(db.update).mockReturnValueOnce(chain as never)
    mockCategoryFindFirst.mockResolvedValue({ id: 'category_1', slug: 'cat', name: 'Cat' })
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_former', displayName: 'Jane', avatarUrl: null })

    await expect(
      updateArticle('article_1' as HelpCenterArticleId, {}, 'principal_former' as PrincipalId)
    ).resolves.toBeDefined()
  })

  it('accepts a member-role authorId in updateArticle', async () => {
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_member', role: 'member', type: 'user' })

    const { db } = await import('@/lib/server/db')
    const chain: Record<string, unknown> = {}
    chain.set = vi.fn(() => chain)
    chain.where = vi.fn(() => chain)
    chain.returning = vi.fn().mockResolvedValue([{
      id: 'article_1' as HelpCenterArticleId,
      slug: 'test', title: 'Test', content: 'Content',
      contentJson: null, categoryId: 'category_1',
      principalId: 'principal_member', publishedAt: null,
      viewCount: 0, helpfulCount: 0, notHelpfulCount: 0,
      createdAt: new Date(), updatedAt: new Date(),
    }])
    vi.mocked(db.update).mockReturnValueOnce(chain as never)
    mockCategoryFindFirst.mockResolvedValue({ id: 'category_1', slug: 'cat', name: 'Cat' })
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_member', displayName: 'Jane', avatarUrl: null })

    await expect(
      updateArticle('article_1' as HelpCenterArticleId, {}, 'principal_member' as PrincipalId)
    ).resolves.toBeDefined()
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
        id: 'article_1' as HelpCenterArticleId,
        slug: 'test',
        title: 'Test',
        description: 'Updated desc',
        position: 3,
        content: 'Content',
        contentJson: null,
        categoryId: 'category_1',
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
      id: 'category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    await updateArticle('article_1' as HelpCenterArticleId, {
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

describe('recordArticleFeedback', () => {
  it('inserts new feedback when no existing feedback', async () => {
    // Article exists
    mockArticleFindFirst.mockResolvedValue({
      id: 'article_1' as HelpCenterArticleId,
      slug: 'test',
      title: 'Test',
      content: 'Content',
      contentJson: null,
      categoryId: 'category_1',
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
      id: 'category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    await recordArticleFeedback(
      'article_1' as HelpCenterArticleId,
      true,
      'principal_1' as PrincipalId
    )

    // Should have inserted feedback + updated article count
    expect(insertValuesCalls.length).toBeGreaterThan(0)
  })

  it('returns early when feedback is unchanged', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'article_1' as HelpCenterArticleId,
      slug: 'test',
      title: 'Test',
      content: 'Content',
      contentJson: null,
      categoryId: 'category_1',
      principalId: 'principal_1',
      publishedAt: new Date(),
      viewCount: 0,
      helpfulCount: 1,
      notHelpfulCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1',
      slug: 'test',
      name: 'Test',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    // Existing feedback with same value
    mockFeedbackFindFirst.mockResolvedValue({
      id: 'article_feedback_1',
      articleId: 'article_1',
      principalId: 'principal_1',
      helpful: true,
    })

    await recordArticleFeedback(
      'article_1' as HelpCenterArticleId,
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

// ============================================================================
// restoreCategory tests
// ============================================================================

describe('restoreCategory', () => {
  function makeRestoredCategoryChain(captureSetCalls?: unknown[][]) {
    const chain: Record<string, unknown> = {}
    chain.set = vi.fn((...args: unknown[]) => {
      if (captureSetCalls) captureSetCalls.push(args)
      return chain
    })
    chain.where = vi.fn().mockReturnValue(chain)
    chain.returning = vi.fn().mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'getting-started',
        name: 'Getting Started',
        description: null,
        isPublic: true,
        position: 0,
        parentId: null,
        icon: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])
    return chain
  }

  it('restores a deleted category within the 30-day window', async () => {
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'getting-started',
      name: 'Getting Started',
      deletedAt: recentDeletedAt,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })

    const setCallsCapture: unknown[][] = []
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.update).mockReturnValueOnce(makeRestoredCategoryChain(setCallsCapture) as never)

    const result = await restoreCategory('category_1' as HelpCenterCategoryId)
    expect(result.id).toBe('category_1')
    expect(result.deletedAt).toBeNull()
    expect(setCallsCapture.length).toBeGreaterThan(0)
    const setArgs = setCallsCapture[0][0] as Record<string, unknown>
    expect(setArgs.deletedAt).toBeNull()
  })

  it('throws NotFoundError for a non-existent category', async () => {
    mockCategoryFindFirst.mockResolvedValue(null)
    await expect(restoreCategory('category_missing' as HelpCenterCategoryId)).rejects.toMatchObject(
      { code: 'CATEGORY_NOT_FOUND' }
    )
  })

  it('throws ValidationError when category is not deleted', async () => {
    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'live',
      name: 'Live Category',
      deletedAt: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })
    await expect(restoreCategory('category_1' as HelpCenterCategoryId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('throws ValidationError when category is outside the 30-day restore window', async () => {
    const oldDeletedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days ago
    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1' as HelpCenterCategoryId,
      slug: 'old',
      name: 'Old Category',
      deletedAt: oldDeletedAt,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })
    await expect(restoreCategory('category_1' as HelpCenterCategoryId)).rejects.toMatchObject({
      code: 'RESTORE_EXPIRED',
    })
  })

  it('refuses to restore a child under a still-deleted parent', async () => {
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'category_child' as HelpCenterCategoryId,
      slug: 'child',
      name: 'Child Category',
      parentId: 'category_parent' as HelpCenterCategoryId,
      deletedAt: recentDeletedAt,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'category_parent' as HelpCenterCategoryId,
      deletedAt: recentDeletedAt,
    })
    await expect(restoreCategory('category_child' as HelpCenterCategoryId)).rejects.toMatchObject({
      code: 'PARENT_DELETED',
    })
  })

  it('restores a child when its parent is already active', async () => {
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'category_child' as HelpCenterCategoryId,
      slug: 'child',
      name: 'Child Category',
      parentId: 'category_parent' as HelpCenterCategoryId,
      deletedAt: recentDeletedAt,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    })
    mockCategoryFindFirst.mockResolvedValueOnce({
      id: 'category_parent' as HelpCenterCategoryId,
      deletedAt: null,
    })
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.update).mockReturnValueOnce(makeRestoredCategoryChain() as never)
    const result = await restoreCategory('category_child' as HelpCenterCategoryId)
    expect(result.deletedAt).toBeNull()
  })
})

// ============================================================================
// restoreArticle tests
// ============================================================================

describe('restoreArticle', () => {
  function makeRestoredArticleChain(captureSetCalls?: unknown[][]) {
    const chain: Record<string, unknown> = {}
    chain.set = vi.fn((...args: unknown[]) => {
      if (captureSetCalls) captureSetCalls.push(args)
      return chain
    })
    chain.where = vi.fn().mockReturnValue(chain)
    chain.returning = vi.fn().mockResolvedValue([
      {
        id: 'article_1' as HelpCenterArticleId,
        slug: 'how-to-start',
        title: 'How to Start',
        content: 'Some content',
        contentJson: null,
        categoryId: 'category_1',
        principalId: 'principal_1',
        publishedAt: null,
        viewCount: 0,
        helpfulCount: 0,
        notHelpfulCount: 0,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])
    return chain
  }

  it('restores a deleted article within the 30-day window', async () => {
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
    mockArticleFindFirst.mockResolvedValue({
      id: 'article_1' as HelpCenterArticleId,
      slug: 'how-to-start',
      title: 'How to Start',
      content: 'Some content',
      contentJson: null,
      categoryId: 'category_1',
      principalId: 'principal_1',
      publishedAt: null,
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      deletedAt: recentDeletedAt,
    })

    const setCallsCapture: unknown[][] = []
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.update).mockReturnValueOnce(makeRestoredArticleChain(setCallsCapture) as never)

    mockCategoryFindFirst.mockResolvedValue({
      id: 'category_1',
      slug: 'getting-started',
      name: 'Getting Started',
    })
    mockPrincipalFindFirst.mockResolvedValue(null)

    const result = await restoreArticle('article_1' as HelpCenterArticleId)
    expect(result.id).toBe('article_1')
    expect(result.deletedAt).toBeNull()
    expect(setCallsCapture.length).toBeGreaterThan(0)
    const setArgs = setCallsCapture[0][0] as Record<string, unknown>
    expect(setArgs.deletedAt).toBeNull()
  })

  it('throws NotFoundError for a non-existent article', async () => {
    mockArticleFindFirst.mockResolvedValue(null)
    await expect(restoreArticle('article_missing' as HelpCenterArticleId)).rejects.toMatchObject({
      code: 'ARTICLE_NOT_FOUND',
    })
  })

  it('throws ValidationError when article is not deleted', async () => {
    mockArticleFindFirst.mockResolvedValue({
      id: 'article_1' as HelpCenterArticleId,
      slug: 'live',
      title: 'Live Article',
      content: 'Content',
      contentJson: null,
      categoryId: 'category_1',
      principalId: 'principal_1',
      publishedAt: null,
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      deletedAt: null, // not deleted
    })
    await expect(restoreArticle('article_1' as HelpCenterArticleId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('throws ValidationError when article is outside the 30-day restore window', async () => {
    const oldDeletedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days ago
    mockArticleFindFirst.mockResolvedValue({
      id: 'article_1' as HelpCenterArticleId,
      slug: 'old',
      title: 'Old Article',
      content: 'Content',
      contentJson: null,
      categoryId: 'category_1',
      principalId: 'principal_1',
      publishedAt: null,
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      deletedAt: oldDeletedAt,
    })
    await expect(restoreArticle('article_1' as HelpCenterArticleId)).rejects.toMatchObject({
      code: 'RESTORE_EXPIRED',
    })
  })
})

// ============================================================================
// listCategories({ showDeleted: true }) tests
// ============================================================================

describe('listCategories with showDeleted option', () => {
  it('returns deleted categories within the 30-day window', async () => {
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_deleted' as HelpCenterCategoryId,
        slug: 'deleted-cat',
        name: 'Deleted Category',
        description: null,
        isPublic: true,
        position: 0,
        parentId: null,
        icon: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: recentDeletedAt,
        deletedAt: recentDeletedAt,
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([]),
      }),
    })

    const result = await listCategories({ showDeleted: true })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Deleted Category')
    // findMany should have been called with deleted filter (not isNull)
    expect(mockCategoryFindMany).toHaveBeenCalledTimes(1)
  })

  it('returns 0 article count for deleted categories with no deleted articles', async () => {
    const recentDeletedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_deleted' as HelpCenterCategoryId,
        slug: 'deleted-cat',
        name: 'Deleted Category',
        description: null,
        isPublic: true,
        position: 0,
        parentId: null,
        icon: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: recentDeletedAt,
        deletedAt: recentDeletedAt,
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([]),
      }),
    })

    const result = await listCategories({ showDeleted: true })
    expect(result[0].articleCount).toBe(0)
  })

  it('returns live categories by default (no options)', async () => {
    mockCategoryFindMany.mockResolvedValue([
      {
        id: 'category_1' as HelpCenterCategoryId,
        slug: 'live',
        name: 'Live Category',
        description: null,
        isPublic: true,
        position: 0,
        parentId: null,
        icon: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ])

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue([]),
      }),
    })

    const result = await listCategories()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Live Category')
  })
})

// ============================================================================
// listArticles({ showDeleted: true }) tests
// ============================================================================

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

// ============================================================================
// listArticles sort param tests
// ============================================================================

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
    // desc should be called for newest order
    expect(descMock).toHaveBeenCalled()
    expect(ascMock).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'created_at' }))
  })

  it('returns articles with sort=oldest using asc order', async () => {
    const { asc: ascMock } = await import('@/lib/server/db')
    mockArticleFindMany.mockResolvedValue([makeArticle('article_2', 'Article B')])

    const result = await listArticles({ sort: 'oldest' })
    expect(result.items).toHaveLength(1)
    // asc should be called for oldest order
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
