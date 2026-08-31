/**
 * Server Functions for Help Center Operations
 */

import { createServerFn } from '@tanstack/react-start'
import type { KbCategoryId, KbArticleId, KbArticleFeedbackId, PrincipalId } from '@quackback/ids'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import {
  requireAuth,
  getOptionalAuth,
  hasAuthCredentials,
  policyActorFromAuth,
} from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  listCategories,
  listPublicCategoryEditors,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  restoreCategory,
  listArticles,
  listArticlePerformance,
  listPublicArticles,
  listPopularPublicArticles,
  getArticleById,
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
  restoreArticle,
  recordArticleFeedback,
  attachArticleFeedbackReason,
  listArticleFeedbackReasons,
} from '@/lib/server/domains/help-center/help-center.service'
import {
  listCategoriesSchema,
  getCategorySchema,
  deleteCategorySchema,
  createCategorySchema,
  updateCategorySchema,
  createArticleSchema,
  updateArticleSchema,
  getArticleSchema,
  deleteArticleSchema,
  listArticlesSchema,
  listArticlePerformanceSchema,
  listSearchTermsSchema,
  listPublicArticlesSchema,
  publishArticleSchema,
  unpublishArticleSchema,
  articleFeedbackSchema,
  articleFeedbackReasonSchema,
  listArticleFeedbackReasonsSchema,
  getCategoryBySlugSchema,
  getArticleBySlugSchema,
  restoreCategorySchema,
  restoreArticleSchema,
} from '@/lib/shared/schemas/help-center'
import { z } from 'zod'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'
import { logger } from '@/lib/server/logger'
import { formatHcIdSlug, parseHcIdSlug } from '@/lib/shared/help-center-url'

const log = logger.child({ component: 'help-center' })

/**
 * Resolve the public help-center viewer for the category segment gate.
 * Anonymous requests skip the DB entirely (fail closed: gated content is
 * invisible); signed-in requests resolve segment memberships via the
 * standard policy-actor path.
 */
async function publicViewer(): Promise<Actor> {
  // Cookie (portal) or Bearer (widget iframe) — anything else is anonymous
  // without a DB round-trip, and fails closed on gated content.
  if (!hasAuthCredentials()) return ANONYMOUS_ACTOR
  return policyActorFromAuth(await getOptionalAuth())
}

// ============================================================================
// Helper: serialize article dates
// ============================================================================

function serializeArticle<
  T extends { createdAt: Date; updatedAt: Date; publishedAt: Date | null; deletedAt?: Date | null },
>(article: T) {
  // embedding (pgvector) and searchVector (tsvector) are not JSON-serializable
  // through the server-fn boundary and 404 the public article page if spread.
  const {
    embedding: _embedding,
    searchVector: _searchVector,
    ...rest
  } = article as T & { embedding?: unknown; searchVector?: unknown }
  return {
    ...rest,
    createdAt: toIsoString(article.createdAt),
    updatedAt: toIsoString(article.updatedAt),
    publishedAt: toIsoStringOrNull(article.publishedAt),
    deletedAt: toIsoStringOrNull(article.deletedAt ?? null),
  }
}

function serializeCategory<T extends { createdAt: Date; updatedAt: Date; deletedAt?: Date | null }>(
  cat: T
) {
  return {
    ...cat,
    createdAt: toIsoString(cat.createdAt),
    updatedAt: toIsoString(cat.updatedAt),
    deletedAt: 'deletedAt' in cat ? toIsoStringOrNull(cat.deletedAt ?? null) : undefined,
  }
}

// ============================================================================
// Category Server Functions
// ============================================================================

export const listCategoriesFn = createServerFn({ method: 'GET' })
  .validator(listCategoriesSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const categories = await listCategories({ showDeleted: data.showDeleted })
    return categories.map(serializeCategory)
  })

export const listPublicCategoriesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ locale: z.string().optional() }))
  .handler(async ({ data }) => {
    const { listPublicCategoriesForLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const categories = await listPublicCategoriesForLocale(
      data.locale ?? DEFAULT_LOCALE,
      await publicViewer()
    )
    return categories.map(serializeCategory)
  })

export const getCategoryFn = createServerFn({ method: 'GET' })
  .validator(getCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const category = await getCategoryById(data.id as KbCategoryId)
    return serializeCategory(category)
  })

export const getPublicCategoryBySlugFn = createServerFn({ method: 'GET' })
  .validator(getCategoryBySlugSchema)
  .handler(async ({ data }) => {
    // Use the locale-aware public lookup so categories an admin marked
    // private, or that have no translation in the requested locale, aren't
    // reachable by direct-slug lookup. The route serves unauthenticated
    // help-center traffic.
    const { getPublicCategoryBySlugForLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const category = await getPublicCategoryBySlugForLocale(
      data.slug,
      data.locale ?? DEFAULT_LOCALE,
      await publicViewer()
    )
    return serializeCategory(category)
  })

export const createCategoryFn = createServerFn({ method: 'POST' })
  .validator(createCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const category = await createCategory(data)
    return serializeCategory(category)
  })

export const updateCategoryFn = createServerFn({ method: 'POST' })
  .validator(updateCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const category = await updateCategory(data.id as KbCategoryId, data)
    return serializeCategory(category)
  })

export const deleteCategoryFn = createServerFn({ method: 'POST' })
  .validator(deleteCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    await deleteCategory(data.id as KbCategoryId)
    return { success: true }
  })

// ============================================================================
// Article Server Functions
// ============================================================================

export const listArticlesFn = createServerFn({ method: 'GET' })
  .validator(listArticlesSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const result = await listArticles(data)
    return {
      ...result,
      items: result.items.map(serializeArticle),
    }
  })

export const listArticlePerformanceFn = createServerFn({ method: 'GET' })
  .validator(listArticlePerformanceSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return listArticlePerformance(data.limit)
  })

export const listSearchTermsFn = createServerFn({ method: 'GET' })
  .validator(listSearchTermsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const { listTopSearchTerms } =
      await import('@/lib/server/domains/help-center/help-center.search-analytics')
    const rows = await listTopSearchTerms({ days: data.days, limit: data.limit })
    return rows.map((row) => ({ ...row, lastSearchedAt: row.lastSearchedAt.toISOString() }))
  })

export const restoreCategoryFn = createServerFn({ method: 'POST' })
  .validator(restoreCategorySchema)
  .handler(async ({ data }) => {
    log.debug({ category_id: data.id }, 'restore category')
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const category = await restoreCategory(data.id as KbCategoryId)
    log.info({ category_id: category.id }, 'category restored')
    return serializeCategory(category)
  })

export const restoreArticleFn = createServerFn({ method: 'POST' })
  .validator(restoreArticleSchema)
  .handler(async ({ data }) => {
    log.debug({ article_id: data.id }, 'restore article')
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const article = await restoreArticle(data.id as KbArticleId)
    log.info({ article_id: article.id }, 'article restored')
    return serializeArticle(article)
  })

export const listPublicArticlesFn = createServerFn({ method: 'GET' })
  .validator(listPublicArticlesSchema)
  .handler(async ({ data }) => {
    const result = await listPublicArticles(data, await publicViewer())
    return {
      ...result,
      items: result.items.map(serializeArticle),
    }
  })

export const listPublicArticlesForCategoryFn = createServerFn({ method: 'GET' })
  .validator(z.object({ categoryId: z.string(), locale: z.string().optional() }))
  .handler(async ({ data }) => {
    const { listPublicArticlesForCategoryLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const articles = await listPublicArticlesForCategoryLocale(
      data.categoryId,
      data.locale ?? DEFAULT_LOCALE,
      await publicViewer()
    )
    return articles.map((a) => ({
      ...a,
      publishedAt: toIsoStringOrNull(a.publishedAt),
    }))
  })

/**
 * Composed category-page load: fetches the category (by slug), every public
 * category (for breadcrumbs + subcategory discovery), the category's own
 * articles, and each subcategory's articles — using a SINGLE batched articles
 * query for the parent + all subcategories instead of one RPC per subcategory.
 * Returns the exact shape the category page consumes
 * ({ category, articles, subcategories: [...with articles], allCategories }),
 * so it collapses the route loader's prior 1 + 2 + N-call waterfall to one call.
 */
export const getPublicCategoryPageFn = createServerFn({ method: 'GET' })
  .validator(getCategoryBySlugSchema)
  .handler(async ({ data }) => {
    const {
      getPublicCategoryBySlugForLocale,
      listPublicCategoriesForLocale,
      listPublicArticlesForCategoriesLocale,
    } = await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const locale = data.locale ?? DEFAULT_LOCALE
    const viewer = await publicViewer()

    const category = await getPublicCategoryBySlugForLocale(data.slug, locale, viewer)
    const allCategories = await listPublicCategoriesForLocale(locale, viewer)
    const subcategories = allCategories.filter((c) => c.parentId === category.id)

    // One batched query for the parent + all subcategory ids, grouped by
    // category, then split back out per category below.
    const articlesByCategory = await listPublicArticlesForCategoriesLocale(
      [category.id, ...subcategories.map((s) => s.id)],
      locale,
      viewer
    )
    const serializeArticles = (categoryId: string) =>
      (articlesByCategory.get(categoryId) ?? []).map((a) => ({
        ...a,
        publishedAt: toIsoStringOrNull(a.publishedAt),
      }))

    return {
      category: serializeCategory(category),
      articles: serializeArticles(category.id),
      subcategories: subcategories.map((sub) => ({
        ...serializeCategory(sub),
        articles: serializeArticles(sub.id),
      })),
      allCategories: allCategories.map(serializeCategory),
    }
  })

const publicIdSlugSchema = z.object({
  idSlug: z.string().min(1),
  locale: z.string().optional(),
})

/**
 * Composed public article page: lookup by numeric urlId (`{urlId}-{slug}`),
 * plus siblings, breadcrumbs, and related articles. Related-article failures
 * must not 404 the page — they degrade to an empty list.
 */
export const getPublicArticlePageFn = createServerFn({ method: 'GET' })
  .validator(publicIdSlugSchema)
  .handler(async ({ data }) => {
    const parsed = parseHcIdSlug(data.idSlug)
    if (!parsed) {
      const { NotFoundError } = await import('@/lib/shared/errors')
      throw new NotFoundError('ARTICLE_NOT_FOUND', 'Article not found')
    }

    const {
      getPublicArticleByUrlIdForLocale,
      listPublicCategoriesForLocale,
      listPublicArticlesForCategoryLocale,
    } = await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const { getRelatedArticles, RELATED_ARTICLES_LIMIT } =
      await import('@/lib/server/domains/help-center/help-center-related.service')
    const locale = data.locale ?? DEFAULT_LOCALE
    const viewer = await publicViewer()

    const article = await getPublicArticleByUrlIdForLocale(parsed.urlId, locale, viewer)
    const canonicalIdSlug = formatHcIdSlug(article.urlId, article.slug)

    const [allCategories, siblings] = await Promise.all([
      listPublicCategoriesForLocale(locale, viewer),
      listPublicArticlesForCategoryLocale(article.category.id, locale, viewer),
    ])

    let related: Awaited<ReturnType<typeof getRelatedArticles>> = []
    try {
      related = await getRelatedArticles(article.id, RELATED_ARTICLES_LIMIT, viewer)
    } catch (err) {
      log.warn({ err, article_id: article.id }, 'related articles failed; rendering without them')
    }

    const { helpfulCount: _h, notHelpfulCount: _n, ...publicArticle } = serializeArticle(article)

    return {
      canonicalIdSlug,
      article: publicArticle,
      category: article.category,
      articles: siblings.map((a) => ({
        ...a,
        publishedAt: toIsoStringOrNull(a.publishedAt),
      })),
      allCategories: allCategories.map(serializeCategory),
      related,
    }
  })

/** Composed collection page looked up by numeric urlId. */
export const getPublicCollectionPageFn = createServerFn({ method: 'GET' })
  .validator(publicIdSlugSchema)
  .handler(async ({ data }) => {
    const parsed = parseHcIdSlug(data.idSlug)
    if (!parsed) {
      const { NotFoundError } = await import('@/lib/shared/errors')
      throw new NotFoundError('CATEGORY_NOT_FOUND', 'Collection not found')
    }

    const {
      getPublicCategoryByUrlIdForLocale,
      listPublicCategoriesForLocale,
      listPublicArticlesForCategoriesLocale,
    } = await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const locale = data.locale ?? DEFAULT_LOCALE
    const viewer = await publicViewer()

    const category = await getPublicCategoryByUrlIdForLocale(parsed.urlId, locale, viewer)
    const allCategories = await listPublicCategoriesForLocale(locale, viewer)
    const subcategories = allCategories.filter((c) => c.parentId === category.id)
    const articlesByCategory = await listPublicArticlesForCategoriesLocale(
      [category.id, ...subcategories.map((s) => s.id)],
      locale,
      viewer
    )
    const serializeArticles = (categoryId: string) =>
      (articlesByCategory.get(categoryId) ?? []).map((a) => ({
        ...a,
        publishedAt: toIsoStringOrNull(a.publishedAt),
      }))

    return {
      canonicalIdSlug: formatHcIdSlug(category.urlId, category.slug),
      category: serializeCategory(category),
      articles: serializeArticles(category.id),
      subcategories: subcategories.map((sub) => ({
        ...serializeCategory(sub),
        articles: serializeArticles(sub.id),
      })),
      allCategories: allCategories.map(serializeCategory),
    }
  })

export const listPublicCategoryEditorsFn = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(async () => {
    return listPublicCategoryEditors()
  })

export const listPopularPublicArticlesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ limit: z.number().int().min(1).max(20).optional() }))
  .handler(async ({ data }) => {
    return listPopularPublicArticles(data.limit ?? 6, await publicViewer())
  })

export const getArticleFn = createServerFn({ method: 'GET' })
  .validator(getArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const article = await getArticleById(data.id as KbArticleId)
    return serializeArticle(article)
  })

export const getPublicArticleBySlugFn = createServerFn({ method: 'GET' })
  .validator(getArticleBySlugSchema)
  .handler(async ({ data }) => {
    const { getPublicArticleBySlugForLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const { DEFAULT_LOCALE } = await import('@/lib/shared/i18n')
    const article = await getPublicArticleBySlugForLocale(
      data.slug,
      data.locale ?? DEFAULT_LOCALE,
      await publicViewer()
    )
    const { helpfulCount: _h, notHelpfulCount: _n, ...publicArticle } = serializeArticle(article)
    return publicArticle
  })

export const getRelatedPublicArticlesFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      articleId: z.string().min(1),
      limit: z.number().int().min(1).max(10).optional(),
    })
  )
  .handler(async ({ data }) => {
    const { getRelatedArticles, RELATED_ARTICLES_LIMIT } =
      await import('@/lib/server/domains/help-center/help-center-related.service')
    return getRelatedArticles(
      data.articleId,
      data.limit ?? RELATED_ARTICLES_LIMIT,
      await publicViewer()
    )
  })

export const createArticleFn = createServerFn({ method: 'POST' })
  .validator(createArticleSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const article = await createArticle(
      {
        ...data,
        contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : null,
      },
      auth.principal.id as PrincipalId
    )
    return serializeArticle(article)
  })

export const updateArticleFn = createServerFn({ method: 'POST' })
  .validator(updateArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const article = await updateArticle(data.id as KbArticleId, {
      ...data,
      contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : data.contentJson,
    })
    return serializeArticle(article)
  })

export const publishArticleFn = createServerFn({ method: 'POST' })
  .validator(publishArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const article = await publishArticle(data.id as KbArticleId)
    return serializeArticle(article)
  })

export const unpublishArticleFn = createServerFn({ method: 'POST' })
  .validator(unpublishArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const article = await unpublishArticle(data.id as KbArticleId)
    return serializeArticle(article)
  })

export const deleteArticleFn = createServerFn({ method: 'POST' })
  .validator(deleteArticleSchema)
  .handler(async ({ data }) => {
    // Soft delete (deleteArticle sets deletedAt) — team OK.
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    await deleteArticle(data.id as KbArticleId)
    return { success: true }
  })

export const recordArticleFeedbackFn = createServerFn({ method: 'POST' })
  .validator(articleFeedbackSchema)
  .handler(async ({ data }) => {
    const auth = await getOptionalAuth()
    const feedbackId = await recordArticleFeedback(
      data.articleId as KbArticleId,
      data.helpful,
      (auth?.principal?.id as PrincipalId) ?? null
    )
    // The id is the visitor's handle on their own vote, and the only one an
    // anonymous visitor has for attaching a reason to it afterwards.
    return { success: true, feedbackId }
  })

export const submitArticleFeedbackReasonFn = createServerFn({ method: 'POST' })
  .validator(articleFeedbackReasonSchema)
  .handler(async ({ data }) => {
    await attachArticleFeedbackReason(data.feedbackId as KbArticleFeedbackId, data.reason)
    return { success: true }
  })

export const listArticleFeedbackReasonsFn = createServerFn({ method: 'GET' })
  .validator(listArticleFeedbackReasonsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const reasons = await listArticleFeedbackReasons(data.articleId as KbArticleId, data.limit)
    return reasons.map((entry) => ({
      id: entry.id,
      reason: entry.reason,
      createdAt: toIsoString(entry.createdAt),
    }))
  })

// ============================================================================
// Public Hybrid Search
// ============================================================================

export const searchPublicArticlesFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(20).optional(),
      locale: z.string().optional(),
    })
  )
  .handler(async ({ data }) => {
    const [{ hybridSearchForLocale, resolveSearchLocale }, { getHelpCenterConfig }] =
      await Promise.all([
        import('@/lib/server/domains/help-center/help-center-search.service'),
        import('@/lib/server/domains/settings/settings.service'),
      ])
    const config = await getHelpCenterConfig()
    const locale = resolveSearchLocale(
      data.locale,
      config.locales.additional,
      config.locales.default
    )
    return hybridSearchForLocale(data.query, locale, data.limit ?? 10, await publicViewer())
  })
