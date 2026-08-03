/**
 * Differential-coverage tests for help-center server functions.
 *
 * Drives the public-facing handlers so the widget-context filtering
 * helpers (categoryAllowedByWidgetContext / articleAllowedByWidgetContext),
 * the actor resolver, and the dynamic-import branches all execute on both
 * the allowed and the filtered-out paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

// The public fns under test are resolved by name via the exported chain's
// __handler stashed by the mocked createServerFn.
type Chain = {
  validator(): Chain
  handler(fn: AnyHandler): Chain
  __handler?: AnyHandler
}

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        chain.__handler = fn
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockGetRequestHeaders: vi.fn(() => new Headers()),
  mockGetWidgetRequestContext: vi.fn(),
  mockGetOptionalAuth: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockSegmentIdsForPrincipal: vi.fn(),
  mockGetPublicCategoryBySlug: vi.fn(),
  // service fns
  mockListPublicCategories: vi.fn(),
  mockListPublicArticles: vi.fn(),
  mockListPublicArticlesForCategory: vi.fn(),
  mockGetPublicArticleBySlug: vi.fn(),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: hoisted.mockGetRequestHeaders,
}))

vi.mock('@/lib/server/widget/context', () => ({
  getWidgetRequestContext: hoisted.mockGetWidgetRequestContext,
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
  getOptionalAuth: hoisted.mockGetOptionalAuth,
}))

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: hoisted.mockSegmentIdsForPrincipal,
}))

vi.mock('@/lib/server/domains/help-center/help-center.category.service', () => ({
  getPublicCategoryBySlug: hoisted.mockGetPublicCategoryBySlug,
}))

vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  listCategories: vi.fn(),
  listPublicCategories: hoisted.mockListPublicCategories,
  listPublicCategoryEditors: vi.fn(),
  getCategoryById: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  restoreCategory: vi.fn(),
  listArticles: vi.fn(),
  listPublicArticles: hoisted.mockListPublicArticles,
  listPublicArticlesForCategory: hoisted.mockListPublicArticlesForCategory,
  getArticleById: vi.fn(),
  getPublicArticleBySlug: hoisted.mockGetPublicArticleBySlug,
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
  publishArticle: vi.fn(),
  unpublishArticle: vi.fn(),
  deleteArticle: vi.fn(),
  restoreArticle: vi.fn(),
  recordArticleFeedback: vi.fn(),
}))

vi.mock('@/lib/server/sanitize-tiptap', () => ({
  sanitizeTiptapContent: (x: unknown) => x,
}))

import * as hc from '../help-center'

function handlerFor(fnName: keyof typeof hc): AnyHandler {
  const fn = (hc[fnName] as unknown as Chain).__handler
  expect(fn, `${String(fnName)} handler not captured`).toBeTypeOf('function')
  return fn as AnyHandler
}

const NOW = new Date('2026-01-01T00:00:00.000Z')

function makeContext(
  overrides: Partial<{
    profileId: string
    categoryIds: string[]
    articleIds: string[]
  }> = {}
) {
  return {
    claims: null,
    profileId: overrides.profileId,
    contentFilters: {
      help: {
        categoryIds: overrides.categoryIds,
        articleIds: overrides.articleIds,
      },
    },
    supportConfig: {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockGetRequestHeaders.mockReturnValue(new Headers())
  // Default: no widget profile → everything allowed.
  hoisted.mockGetWidgetRequestContext.mockResolvedValue(makeContext())
  hoisted.mockGetOptionalAuth.mockResolvedValue(null)
  hoisted.mockSegmentIdsForPrincipal.mockResolvedValue(new Set(['segment_1']))
})

describe('resolveHelpCenterActor (via listPublicCategoriesFn)', () => {
  it('returns null actor when there is no authenticated principal', async () => {
    hoisted.mockGetOptionalAuth.mockResolvedValue(null)
    hoisted.mockListPublicCategories.mockResolvedValue([])

    await handlerFor('listPublicCategoriesFn')({ data: {} })

    // actor === null → passed straight through to the service.
    expect(hoisted.mockListPublicCategories).toHaveBeenCalledWith(null)
    expect(hoisted.mockSegmentIdsForPrincipal).not.toHaveBeenCalled()
  })

  it('resolves a non-null actor with segment ids when authenticated', async () => {
    hoisted.mockGetOptionalAuth.mockResolvedValue({ principal: { id: 'principal_42' } })
    hoisted.mockListPublicCategories.mockResolvedValue([])

    await handlerFor('listPublicCategoriesFn')({ data: {} })

    expect(hoisted.mockSegmentIdsForPrincipal).toHaveBeenCalledWith('principal_42')
    const actor = hoisted.mockListPublicCategories.mock.calls[0][0]
    expect(actor).toMatchObject({ principalId: 'principal_42' })
    expect(actor.segmentIds.has('segment_1')).toBe(true)
  })
})

describe('listPublicCategoriesFn — categoryAllowedByWidgetContext', () => {
  it('returns all categories when there is no widget profile', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(makeContext())
    hoisted.mockListPublicCategories.mockResolvedValue([
      { id: 'cat_a', createdAt: NOW, updatedAt: NOW },
      { id: 'cat_b', createdAt: NOW, updatedAt: NOW },
    ])

    const result = (await handlerFor('listPublicCategoriesFn')({ data: {} })) as Array<{
      id: string
      createdAt: string
    }>

    expect(result.map((c) => c.id)).toEqual(['cat_a', 'cat_b'])
    // dates serialized to ISO strings
    expect(typeof result[0].createdAt).toBe('string')
  })

  it('returns all categories when profile has an empty category filter', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(
      makeContext({ profileId: 'wp_1', categoryIds: [] })
    )
    hoisted.mockListPublicCategories.mockResolvedValue([
      { id: 'cat_a', createdAt: NOW, updatedAt: NOW },
    ])

    const result = (await handlerFor('listPublicCategoriesFn')({ data: {} })) as Array<{
      id: string
    }>
    expect(result.map((c) => c.id)).toEqual(['cat_a'])
  })

  it('filters categories down to the profile allow-list', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(
      makeContext({ profileId: 'wp_1', categoryIds: ['cat_a'] })
    )
    hoisted.mockListPublicCategories.mockResolvedValue([
      { id: 'cat_a', createdAt: NOW, updatedAt: NOW },
      { id: 'cat_b', createdAt: NOW, updatedAt: NOW },
    ])

    const result = (await handlerFor('listPublicCategoriesFn')({ data: {} })) as Array<{
      id: string
    }>
    expect(result.map((c) => c.id)).toEqual(['cat_a'])
  })
})

describe('getPublicCategoryBySlugFn', () => {
  it('resolves the category via the public category service', async () => {
    hoisted.mockGetPublicCategoryBySlug.mockResolvedValue({
      id: 'cat_a',
      slug: 'getting-started',
      createdAt: NOW,
      updatedAt: NOW,
    })

    const result = (await handlerFor('getPublicCategoryBySlugFn')({
      data: { slug: 'getting-started' },
    })) as { id: string; slug: string }

    expect(hoisted.mockGetPublicCategoryBySlug).toHaveBeenCalledWith('getting-started', null)
    expect(result.id).toBe('cat_a')
  })
})

describe('listPublicArticlesFn — articleAllowedByWidgetContext', () => {
  const article = (id: string, categoryId: string) => ({
    id,
    categoryId,
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: NOW,
  })

  it('returns all articles when there is no widget profile', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(makeContext())
    hoisted.mockListPublicArticles.mockResolvedValue({
      items: [article('art_1', 'cat_a'), article('art_2', 'cat_b')],
      total: 2,
    })

    const result = (await handlerFor('listPublicArticlesFn')({ data: {} })) as {
      items: Array<{ id: string }>
      total: number
    }
    expect(result.items.map((a) => a.id)).toEqual(['art_1', 'art_2'])
    expect(result.total).toBe(2)
  })

  it('filters by category allow-list', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(
      makeContext({ profileId: 'wp_1', categoryIds: ['cat_a'] })
    )
    hoisted.mockListPublicArticles.mockResolvedValue({
      items: [article('art_1', 'cat_a'), article('art_2', 'cat_b')],
      total: 2,
    })

    const result = (await handlerFor('listPublicArticlesFn')({ data: {} })) as {
      items: Array<{ id: string }>
    }
    expect(result.items.map((a) => a.id)).toEqual(['art_1'])
  })

  it('filters by article allow-list', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(
      makeContext({ profileId: 'wp_1', articleIds: ['art_2'] })
    )
    hoisted.mockListPublicArticles.mockResolvedValue({
      items: [article('art_1', 'cat_a'), article('art_2', 'cat_b')],
      total: 2,
    })

    const result = (await handlerFor('listPublicArticlesFn')({ data: {} })) as {
      items: Array<{ id: string }>
    }
    expect(result.items.map((a) => a.id)).toEqual(['art_2'])
  })

  it('resolves category via the nested category.id shape', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(
      makeContext({ profileId: 'wp_1', categoryIds: ['cat_a'] })
    )
    hoisted.mockListPublicArticles.mockResolvedValue({
      items: [
        {
          id: 'art_1',
          category: { id: 'cat_a' },
          createdAt: NOW,
          updatedAt: NOW,
          publishedAt: NOW,
        },
        {
          id: 'art_2',
          category: { id: 'cat_b' },
          createdAt: NOW,
          updatedAt: NOW,
          publishedAt: NOW,
        },
      ],
      total: 2,
    })

    const result = (await handlerFor('listPublicArticlesFn')({ data: {} })) as {
      items: Array<{ id: string }>
    }
    expect(result.items.map((a) => a.id)).toEqual(['art_1'])
  })
})

describe('listPublicArticlesForCategoryFn', () => {
  it('short-circuits to [] when the category is not allowed by the profile', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(
      makeContext({ profileId: 'wp_1', categoryIds: ['cat_a'] })
    )

    const result = await handlerFor('listPublicArticlesForCategoryFn')({
      data: { categoryId: 'cat_blocked' },
    })

    expect(result).toEqual([])
    expect(hoisted.mockListPublicArticlesForCategory).not.toHaveBeenCalled()
  })

  it('lists + filters articles when the category is allowed', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(
      makeContext({ profileId: 'wp_1', categoryIds: ['cat_a'], articleIds: ['art_1'] })
    )
    hoisted.mockListPublicArticlesForCategory.mockResolvedValue([
      { id: 'art_1', publishedAt: NOW },
      { id: 'art_2', publishedAt: NOW },
    ])

    const result = (await handlerFor('listPublicArticlesForCategoryFn')({
      data: { categoryId: 'cat_a' },
    })) as Array<{ id: string; publishedAt: string | null }>

    expect(hoisted.mockListPublicArticlesForCategory).toHaveBeenCalledWith('cat_a', null)
    expect(result.map((a) => a.id)).toEqual(['art_1'])
    expect(typeof result[0].publishedAt).toBe('string')
  })

  it('lists all articles when there is no widget profile', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(makeContext())
    hoisted.mockListPublicArticlesForCategory.mockResolvedValue([
      { id: 'art_1', publishedAt: null },
    ])

    const result = (await handlerFor('listPublicArticlesForCategoryFn')({
      data: { categoryId: 'cat_a' },
    })) as Array<{ id: string; publishedAt: string | null }>

    expect(result.map((a) => a.id)).toEqual(['art_1'])
    expect(result[0].publishedAt).toBeNull()
  })
})

describe('getPublicArticleBySlugFn', () => {
  const baseArticle = {
    id: 'art_1',
    categoryId: 'cat_a',
    createdAt: NOW,
    updatedAt: NOW,
    publishedAt: NOW,
    helpfulCount: 3,
    notHelpfulCount: 1,
  }

  it('returns the article (without feedback counts) when allowed', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(makeContext())
    hoisted.mockGetPublicArticleBySlug.mockResolvedValue(baseArticle)

    const result = (await handlerFor('getPublicArticleBySlugFn')({
      data: { slug: 'my-article' },
    })) as Record<string, unknown>

    expect(hoisted.mockGetPublicArticleBySlug).toHaveBeenCalledWith('my-article', null)
    expect(result.id).toBe('art_1')
    expect(result).not.toHaveProperty('helpfulCount')
    expect(result).not.toHaveProperty('notHelpfulCount')
  })

  it('throws NotFoundError when the article is filtered out by the profile', async () => {
    hoisted.mockGetWidgetRequestContext.mockResolvedValue(
      makeContext({ profileId: 'wp_1', categoryIds: ['cat_other'] })
    )
    hoisted.mockGetPublicArticleBySlug.mockResolvedValue(baseArticle)

    await expect(
      handlerFor('getPublicArticleBySlugFn')({ data: { slug: 'my-article' } })
    ).rejects.toMatchObject({ code: 'ARTICLE_NOT_FOUND' })
  })
})
