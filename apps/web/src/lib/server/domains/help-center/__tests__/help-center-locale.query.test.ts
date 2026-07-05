import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KbCategoryId, KbArticleId } from '@quackback/ids'

const mockListPublicCategories = vi.fn()
const mockGetPublicCategoryBySlug = vi.fn()
const mockListPublicArticlesForCategory = vi.fn()
const mockGetPublicArticleBySlug = vi.fn()
const mockGetPublishedArticleTranslation = vi.fn()
const mockGetCategoryTranslation = vi.fn()
const mockCategoryTranslationFindMany = vi.fn()
const mockArticleTranslationFindMany = vi.fn()
const mockSelectFrom = vi.fn()

vi.mock('../help-center.category.service', () => ({
  listPublicCategories: (...args: unknown[]) => mockListPublicCategories(...args),
  getPublicCategoryBySlug: (...args: unknown[]) => mockGetPublicCategoryBySlug(...args),
}))

vi.mock('../help-center.article.query', () => ({
  listPublicArticlesForCategory: (...args: unknown[]) => mockListPublicArticlesForCategory(...args),
}))

vi.mock('../help-center.article.service', () => ({
  getPublicArticleBySlug: (...args: unknown[]) => mockGetPublicArticleBySlug(...args),
}))

vi.mock('../help-center-translations.service', () => ({
  getPublishedArticleTranslation: (...args: unknown[]) => mockGetPublishedArticleTranslation(...args),
  getCategoryTranslation: (...args: unknown[]) => mockGetCategoryTranslation(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      helpCenterCategoryTranslations: {
        findMany: (...args: unknown[]) => mockCategoryTranslationFindMany(...args),
      },
      helpCenterArticleTranslations: {
        findMany: (...args: unknown[]) => mockArticleTranslationFindMany(...args),
      },
    },
    select: vi.fn(() => ({
      from: (...args: unknown[]) => mockSelectFrom(...args),
    })),
  },
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  and: (...args: unknown[]) => ({ op: 'and', args }),
  inArray: (...args: unknown[]) => ({ op: 'inArray', args }),
  isNull: (...args: unknown[]) => ({ op: 'isNull', args }),
  isNotNull: (...args: unknown[]) => ({ op: 'isNotNull', args }),
  count: () => ({ op: 'count' }),
  helpCenterArticles: { categoryId: 'category_id', deletedAt: 'deleted_at', publishedAt: 'published_at', id: 'id' },
  helpCenterArticleTranslations: { articleId: 'article_id', locale: 'locale', status: 'status' },
  helpCenterCategoryTranslations: { categoryId: 'category_id', locale: 'locale' },
}))

const {
  listPublicCategoriesForLocale,
  getPublicCategoryBySlugForLocale,
  listPublicArticlesForCategoryLocale,
  getPublicArticleBySlugForLocale,
} = await import('../help-center-locale.query')

beforeEach(() => {
  mockListPublicCategories.mockReset()
  mockGetPublicCategoryBySlug.mockReset()
  mockListPublicArticlesForCategory.mockReset()
  mockGetPublicArticleBySlug.mockReset()
  mockGetPublishedArticleTranslation.mockReset()
  mockGetCategoryTranslation.mockReset()
  mockCategoryTranslationFindMany.mockReset()
  mockArticleTranslationFindMany.mockReset()
  mockSelectFrom.mockReset()
})

describe('listPublicCategoriesForLocale', () => {
  it('returns the default-locale list unchanged for the default locale', async () => {
    const categories = [{ id: 'kb_category_1', name: 'Billing' }]
    mockListPublicCategories.mockResolvedValue(categories)

    const result = await listPublicCategoriesForLocale('en')
    expect(result).toBe(categories)
    expect(mockCategoryTranslationFindMany).not.toHaveBeenCalled()
  })

  it('excludes a category with no translated name in the target locale', async () => {
    mockListPublicCategories.mockResolvedValue([{ id: 'kb_category_1', name: 'Billing' }])
    mockCategoryTranslationFindMany.mockResolvedValue([])
    mockSelectFrom.mockReturnValue({
      innerJoin: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }),
    })

    expect(await listPublicCategoriesForLocale('de')).toEqual([])
  })

  it('excludes a category translated but with zero translated-published articles', async () => {
    mockListPublicCategories.mockResolvedValue([{ id: 'kb_category_1', name: 'Billing' }])
    mockCategoryTranslationFindMany.mockResolvedValue([
      { categoryId: 'kb_category_1', name: 'Abrechnung' },
    ])
    mockSelectFrom.mockReturnValue({
      innerJoin: () => ({ where: () => ({ groupBy: () => Promise.resolve([]) }) }),
    })

    expect(await listPublicCategoriesForLocale('de')).toEqual([])
  })

  it('includes a category with a translated name and >=1 translated-published article', async () => {
    mockListPublicCategories.mockResolvedValue([
      { id: 'kb_category_1', name: 'Billing', description: 'EN desc' },
    ])
    mockCategoryTranslationFindMany.mockResolvedValue([
      { categoryId: 'kb_category_1', name: 'Abrechnung', description: 'DE desc' },
    ])
    mockSelectFrom.mockReturnValue({
      innerJoin: () => ({
        where: () => ({
          groupBy: () => Promise.resolve([{ categoryId: 'kb_category_1', translatedCount: 1 }]),
        }),
      }),
    })

    const result = await listPublicCategoriesForLocale('de')
    expect(result).toEqual([
      { id: 'kb_category_1', name: 'Abrechnung', description: 'DE desc' },
    ])
  })
})

describe('getPublicCategoryBySlugForLocale', () => {
  it('returns the base category for the default locale', async () => {
    mockGetPublicCategoryBySlug.mockResolvedValue({ id: 'kb_category_1', name: 'Billing' })
    const result = await getPublicCategoryBySlugForLocale('billing', 'en')
    expect(result).toEqual({ id: 'kb_category_1', name: 'Billing' })
    expect(mockGetCategoryTranslation).not.toHaveBeenCalled()
  })

  it('throws when no translation exists for the target locale', async () => {
    mockGetPublicCategoryBySlug.mockResolvedValue({ id: 'kb_category_1', name: 'Billing' })
    mockGetCategoryTranslation.mockResolvedValue(null)

    await expect(getPublicCategoryBySlugForLocale('billing', 'de')).rejects.toThrow(/translation/i)
  })

  it('overlays the translated name/description', async () => {
    mockGetPublicCategoryBySlug.mockResolvedValue({
      id: 'kb_category_1' as KbCategoryId,
      name: 'Billing',
      description: 'EN',
    })
    mockGetCategoryTranslation.mockResolvedValue({ name: 'Abrechnung', description: 'DE' })

    const result = await getPublicCategoryBySlugForLocale('billing', 'de')
    expect(result.name).toBe('Abrechnung')
    expect(result.description).toBe('DE')
  })
})

describe('listPublicArticlesForCategoryLocale', () => {
  it('returns the default-locale list unchanged for the default locale', async () => {
    const articles = [{ id: 'kb_article_1', title: 'Invoices' }]
    mockListPublicArticlesForCategory.mockResolvedValue(articles)

    const result = await listPublicArticlesForCategoryLocale('kb_category_1', 'en')
    expect(result).toBe(articles)
  })

  it('drops articles with no published translation and overlays the rest', async () => {
    mockListPublicArticlesForCategory.mockResolvedValue([
      { id: 'kb_article_1', title: 'Invoices', description: 'EN' },
      { id: 'kb_article_2', title: 'Refunds', description: 'EN' },
    ])
    mockArticleTranslationFindMany.mockResolvedValue([
      { articleId: 'kb_article_1', title: 'Rechnungen', description: 'DE' },
    ])

    const result = await listPublicArticlesForCategoryLocale('kb_category_1', 'de')
    expect(result).toEqual([{ id: 'kb_article_1', title: 'Rechnungen', description: 'DE' }])
  })
})

describe('getPublicArticleBySlugForLocale', () => {
  it('returns the base article for the default locale', async () => {
    mockGetPublicArticleBySlug.mockResolvedValue({ id: 'kb_article_1', title: 'Invoices' })
    const result = await getPublicArticleBySlugForLocale('invoices', 'en')
    expect(result).toEqual({ id: 'kb_article_1', title: 'Invoices' })
  })

  it('throws when the article has no published translation in that locale', async () => {
    mockGetPublicArticleBySlug.mockResolvedValue({ id: 'kb_article_1', title: 'Invoices' })
    mockGetPublishedArticleTranslation.mockResolvedValue(null)

    await expect(getPublicArticleBySlugForLocale('invoices', 'de')).rejects.toThrow(/translation/i)
  })

  it('overlays translated content, falling back to base contentJson when the translation has none', async () => {
    mockGetPublicArticleBySlug.mockResolvedValue({
      id: 'kb_article_1' as KbArticleId,
      title: 'Invoices',
      description: 'EN',
      content: 'en content',
      contentJson: { type: 'doc', content: [] },
    })
    mockGetPublishedArticleTranslation.mockResolvedValue({
      title: 'Rechnungen',
      description: 'DE',
      content: 'de content',
      contentJson: null,
    })

    const result = await getPublicArticleBySlugForLocale('invoices', 'de')
    expect(result.title).toBe('Rechnungen')
    expect(result.content).toBe('de content')
    expect(result.contentJson).toEqual({ type: 'doc', content: [] })
  })
})
