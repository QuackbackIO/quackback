import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HelpCenterArticleId, PrincipalId } from '@quackback/ids'

const insertValuesCalls: unknown[][] = []
const updateSetCalls: unknown[][] = []
const updateWhereCalls: unknown[][] = []

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
      id: 'article_1' as HelpCenterArticleId,
      slug: 'test',
      title: 'Test',
      description: null,
      position: null,
      content: 'Content',
      contentJson: null,
      categoryId: 'category_1',
      principalId: 'principal_1',
      publishedAt: null,
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
      deletedAt: null,
    },
  ])
  return chain
}

const mockCategoryFindFirst = vi.fn()
const mockArticleFindFirst = vi.fn()
const mockFeedbackFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      helpCenterCategories: {
        findFirst: (...args: unknown[]) => mockCategoryFindFirst(...args),
      },
      helpCenterArticles: {
        findFirst: (...args: unknown[]) => mockArticleFindFirst(...args),
        findMany: vi.fn(),
      },
      helpCenterArticleFeedback: {
        findFirst: (...args: unknown[]) => mockFeedbackFindFirst(...args),
      },
      principal: {
        findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args),
      },
    },
    insert: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.values = vi.fn((...args: unknown[]) => {
        insertValuesCalls.push(args)
        return chain
      })
      chain.returning = vi.fn().mockResolvedValue([])
      return chain
    }),
    update: vi.fn(() => createUpdateChain()),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const self = (await import('@/lib/server/db')).db
      return fn(self)
    }),
  },
  helpCenterCategories: {
    id: 'id',
    slug: 'slug',
    name: 'name',
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

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: vi.fn(() => ({ type: 'doc', content: [] })),
}))

let getArticleById: typeof import('../help-center.article.service').getArticleById
let createArticle: typeof import('../help-center.article.service').createArticle
let updateArticle: typeof import('../help-center.article.service').updateArticle
let publishArticle: typeof import('../help-center.article.service').publishArticle
let unpublishArticle: typeof import('../help-center.article.service').unpublishArticle
let deleteArticle: typeof import('../help-center.article.service').deleteArticle
let restoreArticle: typeof import('../help-center.article.service').restoreArticle
let recordArticleFeedback: typeof import('../help-center.article.service').recordArticleFeedback

beforeEach(async () => {
  vi.clearAllMocks()
  insertValuesCalls.length = 0
  updateSetCalls.length = 0
  updateWhereCalls.length = 0

  const mod = await import('../help-center.article.service')
  getArticleById = mod.getArticleById
  createArticle = mod.createArticle
  updateArticle = mod.updateArticle
  publishArticle = mod.publishArticle
  unpublishArticle = mod.unpublishArticle
  deleteArticle = mod.deleteArticle
  restoreArticle = mod.restoreArticle
  recordArticleFeedback = mod.recordArticleFeedback
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
      { categoryId: 'category_1', title: 'How to Start', content: 'Some content' },
      'principal_1' as PrincipalId
    )

    expect(result.title).toBe('How to Start')
    expect(result.category.name).toBe('Getting Started')
  })

  it('throws ValidationError when the calling principal is a service principal and no authorId is given', async () => {
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
    mockPrincipalFindFirst.mockResolvedValueOnce({ id: 'principal_member', role: 'member', type: 'user' })
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
    mockCategoryFindFirst.mockResolvedValue({ id: 'category_1', slug: 'test', name: 'Test' })
    mockPrincipalFindFirst.mockResolvedValue(null)

    const result = await publishArticle('article_1' as HelpCenterArticleId)
    expect(result).toBeDefined()
    expect(updateSetCalls.length).toBeGreaterThan(0)
  })
})

describe('unpublishArticle', () => {
  it('sets publishedAt to null', async () => {
    mockCategoryFindFirst.mockResolvedValue({ id: 'category_1', slug: 'test', name: 'Test' })
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

    mockCategoryFindFirst.mockResolvedValue({ id: 'category_1', slug: 'getting-started', name: 'Getting Started' })
    mockPrincipalFindFirst.mockResolvedValue({ id: 'principal_1', displayName: 'Author', avatarUrl: null, type: 'user' })

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

    mockCategoryFindFirst.mockResolvedValue({ id: 'category_1', slug: 'test', name: 'Test' })
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

describe('recordArticleFeedback', () => {
  it('inserts new feedback when no existing feedback', async () => {
    mockFeedbackFindFirst.mockResolvedValue(null)

    await recordArticleFeedback(
      'article_1' as HelpCenterArticleId,
      true,
      'principal_1' as PrincipalId
    )

    expect(insertValuesCalls.length).toBeGreaterThan(0)
  })

  it('returns early when feedback is unchanged', async () => {
    mockFeedbackFindFirst.mockResolvedValue({
      id: 'article_feedback_1',
      articleId: 'article_1',
      principalId: 'principal_1',
      helpful: true,
    })

    await recordArticleFeedback(
      'article_1' as HelpCenterArticleId,
      true,
      'principal_1' as PrincipalId
    )

    expect(insertValuesCalls).toHaveLength(0)
  })
})

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
    const recentDeletedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
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

    mockCategoryFindFirst.mockResolvedValue({ id: 'category_1', slug: 'getting-started', name: 'Getting Started' })
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
      deletedAt: null,
    })
    await expect(restoreArticle('article_1' as HelpCenterArticleId)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('throws ValidationError when article is outside the 30-day restore window', async () => {
    const oldDeletedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
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
