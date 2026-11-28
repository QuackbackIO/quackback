/**
 * Server Functions for Help Center Operations
 */

import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
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
  countPublicArticleView,
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

/** Whether the portal lets the caller in; a private portal keeps its help
 *  center from whoever it turns away, on every public read (portal and
 *  widget) and not just the page. */
async function portalLetsCallerIn(): Promise<boolean> {
  const { resolvePortalAccessForRequest } = await import('./portal-access')
  return (await resolvePortalAccessForRequest()).granted
}

/** For a write or a single read: "not found" when the portal turns the
 *  caller away, as the page's sign-in wall has it. */

/** The help center's main language: where a request without a language reads. */
async function helpCenterMainLanguage(): Promise<string> {
  const { getHelpCenterConfig } = await import('@/lib/server/domains/settings/settings.service')
  return (await getHelpCenterConfig()).locales?.default ?? 'en'
}

/**
 * The page canonical for help center text in `contentLocale`: that language's
 * own page where the help center offers it, else the main language's page.
 * A page showing text from another language points search engines there.
 */
async function canonicalHelpLocale(contentLocale: string): Promise<string> {
  const { getHelpCenterConfig } = await import('@/lib/server/domains/settings/settings.service')
  const { locales } = await getHelpCenterConfig()
  return contentLocale === locales.default || locales.additional.includes(contentLocale)
    ? contentLocale
    : locales.default
}

export const assertHelpCenterOpenToRequest = createServerOnlyFn(
  async function assertHelpCenterOpenToRequest(): Promise<void> {
    if (!(await portalLetsCallerIn())) {
      const { NotFoundError } = await import('@/lib/shared/errors')
      throw new NotFoundError('HELP_CENTER_NOT_FOUND', 'Help center not found')
    }
  }
)

/**
 * The public help-center reader for the category segment gate, or null when
 * the portal turns the caller away (collections then come back empty, as
 * the other portal reads do). Anonymous requests skip the DB entirely (fail
 * closed: gated content is invisible); signed-in requests resolve segment
 * memberships via the standard policy-actor path.
 */
export const resolveHelpPublicReader = createServerOnlyFn(async function resolveHelpPublicReader(
  auth?: Awaited<ReturnType<typeof getOptionalAuth>> | undefined
): Promise<Actor | null> {
  if (!(await portalLetsCallerIn())) return null
  if (auth !== undefined) return policyActorFromAuth(auth)
  if (!hasAuthCredentials()) return ANONYMOUS_ACTOR
  return policyActorFromAuth(await getOptionalAuth())
})

/** The reader for a single read: "not found" when the portal turns the
 *  caller away. */
export const resolveHelpPublicViewer = createServerOnlyFn(async function resolveHelpPublicViewer(
  auth?: Awaited<ReturnType<typeof getOptionalAuth>> | undefined
): Promise<Actor> {
  const reader = await resolveHelpPublicReader(auth)
  if (!reader) {
    const { NotFoundError } = await import('@/lib/shared/errors')
    throw new NotFoundError('HELP_CENTER_NOT_FOUND', 'Help center not found')
  }
  return reader
})

async function publicViewer(): Promise<Actor> {
  return resolveHelpPublicViewer()
}

// ============================================================================
// Helper: serialize article dates
// ============================================================================

export const serializeArticle = createServerOnlyFn(function serializeArticle<
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
})

export const serializeCategory = createServerOnlyFn(function serializeCategory<
  T extends { createdAt: Date; updatedAt: Date; deletedAt?: Date | null },
>(cat: T) {
  return {
    ...cat,
    createdAt: toIsoString(cat.createdAt),
    updatedAt: toIsoString(cat.updatedAt),
    deletedAt: 'deletedAt' in cat ? toIsoStringOrNull(cat.deletedAt ?? null) : undefined,
  }
})

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
    const reader = await resolveHelpPublicReader()
    if (!reader) return []
    const { listPublicCategoriesWithFallback } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const mainLocale = await helpCenterMainLanguage()
    const categories = await listPublicCategoriesWithFallback(data.locale ?? mainLocale, reader)
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
    // Use the public lookup so categories an admin marked private aren't
    // reachable by direct-slug lookup. The route serves unauthenticated
    // help-center traffic.
    const { getPublicCategoryBySlugForLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const mainLocale = await helpCenterMainLanguage()
    const category = await getPublicCategoryBySlugForLocale(
      data.slug,
      data.locale ?? mainLocale,
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
    const [{ listArticleLanguageSummaries }, { getHelpCenterConfig }] = await Promise.all([
      import('@/lib/server/domains/help-center/help-center-translation-list'),
      import('@/lib/server/domains/settings/settings.service'),
    ])
    const { locales } = await getHelpCenterConfig()
    const languages = await listArticleLanguageSummaries(result.items, [
      locales.default,
      ...locales.additional,
    ])
    return {
      ...result,
      items: result.items.map((a) => ({
        ...serializeArticle(a),
        languages: languages.get(a.id) ?? [],
      })),
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
    const reader = await resolveHelpPublicReader()
    if (!reader) return { items: [], nextCursor: null, hasMore: false }
    const result = await listPublicArticles(data, reader)
    return {
      ...result,
      items: result.items.map(serializeArticle),
    }
  })

export const listPublicArticlesForCategoryFn = createServerFn({ method: 'GET' })
  .validator(z.object({ categoryId: z.string(), locale: z.string().optional() }))
  .handler(async ({ data }) => {
    const reader = await resolveHelpPublicReader()
    if (!reader) return []
    const { listPublicArticlesForCategoryWithFallback } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const mainLocale = await helpCenterMainLanguage()
    const articles = await listPublicArticlesForCategoryWithFallback(
      data.categoryId,
      data.locale ?? mainLocale,
      reader
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
      listPublicCategoriesWithFallback,
      listPublicArticlesForCategoriesWithFallback,
    } = await import('@/lib/server/domains/help-center/help-center-locale.query')
    const mainLocale = await helpCenterMainLanguage()
    const locale = data.locale ?? mainLocale
    const viewer = await publicViewer()

    const category = await getPublicCategoryBySlugForLocale(data.slug, locale, viewer)
    const allCategories = await listPublicCategoriesWithFallback(locale, viewer)
    const subcategories = allCategories.filter((c) => c.parentId === category.id)

    // One batched query for the parent + all subcategory ids, grouped by
    // category, then split back out per category below.
    const articlesByCategory = await listPublicArticlesForCategoriesWithFallback(
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
      listPublicCategoriesWithFallback,
      listPublicArticlesForCategoryWithFallback,
      localizeRelatedArticles,
    } = await import('@/lib/server/domains/help-center/help-center-locale.query')
    const mainLocale = await helpCenterMainLanguage()
    const { getRelatedArticles, RELATED_ARTICLES_LIMIT } =
      await import('@/lib/server/domains/help-center/help-center-related.service')
    const locale = data.locale ?? mainLocale
    const viewer = await publicViewer()

    const article = await getPublicArticleByUrlIdForLocale(parsed.urlId, locale, viewer)
    const canonicalIdSlug = formatHcIdSlug(article.urlId, article.slug)

    const [allCategories, siblings] = await Promise.all([
      listPublicCategoriesWithFallback(locale, viewer),
      listPublicArticlesForCategoryWithFallback(article.category.id, locale, viewer),
    ])

    let related: Awaited<ReturnType<typeof localizeRelatedArticles>> = []
    try {
      related = await localizeRelatedArticles(
        await getRelatedArticles(article.id, RELATED_ARTICLES_LIMIT, viewer),
        locale
      )
    } catch (err) {
      log.warn({ err, article_id: article.id }, 'related articles failed; rendering without them')
    }

    const { helpfulCount: _h, notHelpfulCount: _n, ...publicArticle } = serializeArticle(article)

    return {
      canonicalIdSlug,
      canonicalLocale: await canonicalHelpLocale(article.locale),
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
      listPublicCategoriesWithFallback,
      listPublicArticlesForCategoriesWithFallback,
    } = await import('@/lib/server/domains/help-center/help-center-locale.query')
    const mainLocale = await helpCenterMainLanguage()
    const locale = data.locale ?? mainLocale
    const viewer = await publicViewer()

    const category = await getPublicCategoryByUrlIdForLocale(parsed.urlId, locale, viewer)
    const allCategories = await listPublicCategoriesWithFallback(locale, viewer)
    const subcategories = allCategories.filter((c) => c.parentId === category.id)
    const articlesByCategory = await listPublicArticlesForCategoriesWithFallback(
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
      canonicalLocale: await canonicalHelpLocale(category.locale),
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
    if (!(await portalLetsCallerIn())) return []
    return listPublicCategoryEditors()
  })

export const listPopularPublicArticlesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ limit: z.number().int().min(1).max(20).optional() }))
  .handler(async ({ data }) => {
    const reader = await resolveHelpPublicReader()
    if (!reader) return []
    return listPopularPublicArticles(data.limit ?? 6, reader)
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
    const mainLocale = await helpCenterMainLanguage()
    const article = await getPublicArticleBySlugForLocale(
      data.slug,
      data.locale ?? mainLocale,
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
    const reader = await resolveHelpPublicReader()
    if (!reader) return []
    const { getRelatedArticles, RELATED_ARTICLES_LIMIT } =
      await import('@/lib/server/domains/help-center/help-center-related.service')
    return getRelatedArticles(data.articleId, data.limit ?? RELATED_ARTICLES_LIMIT, reader)
  })

/**
 * Count a view of a public article, called once by the canonical article page
 * when it shows the article. Not from the page's loader: the loader also runs
 * when a link is hovered (preload), which is not a visit. Rate limited and
 * counted once per article per address an hour (countPublicArticleView).
 */
export const recordPublicArticleViewFn = createServerFn({ method: 'POST' })
  .validator(z.object({ articleId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getClientIp } = await import('@/lib/server/domains/api/rate-limit')
    const counted = await countPublicArticleView(
      data.articleId,
      getClientIp(getRequestHeaders()),
      await publicViewer()
    )
    return { success: true, counted }
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
    await assertHelpCenterOpenToRequest()
    const auth = await getOptionalAuth()
    const feedbackId = await recordArticleFeedback(
      data.articleId as KbArticleId,
      data.helpful,
      (auth?.principal?.id as PrincipalId) ?? null,
      { replaces: (data.replacesFeedbackId as KbArticleFeedbackId | undefined) ?? null }
    )
    // The id is the visitor's handle on their own vote, and the only one an
    // anonymous visitor has for attaching a reason to it, or for changing it.
    return { success: true, feedbackId }
  })

export const submitArticleFeedbackReasonFn = createServerFn({ method: 'POST' })
  .validator(articleFeedbackReasonSchema)
  .handler(async ({ data }) => {
    await assertHelpCenterOpenToRequest()
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
    const reader = await resolveHelpPublicReader()
    if (!reader) return []
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
    return hybridSearchForLocale(data.query, locale, data.limit ?? 10, reader)
  })

/**
 * Public article by widget `open({ articleId })` ref — same shape as
 * getPublicArticleBySlugFn. `article_` and `kb_article_` TypeIDs look up by
 * id (same UUID); anything else is a slug. Missing or gated → null.
 * Appended so existing help-center handler indices stay put.
 */
export const resolvePublicArticleRefFn = createServerFn({ method: 'GET' })
  .validator(z.object({ ref: z.string().min(1), locale: z.string().optional() }))
  .handler(async ({ data }) => {
    const { canonicalArticleTypeId } = await import('@/lib/shared/widget/article-ref')
    const { getPublicArticleByIdForLocale, getPublicArticleBySlugForLocale } =
      await import('@/lib/server/domains/help-center/help-center-locale.query')
    const mainLocale = await helpCenterMainLanguage()
    const { NotFoundError } = await import('@/lib/shared/errors')
    const viewer = await resolveHelpPublicReader()
    if (!viewer) return null
    const locale = data.locale ?? mainLocale
    try {
      const kbId = canonicalArticleTypeId(data.ref)
      // An article with no version in the language reads in its own.
      const article = kbId
        ? await getPublicArticleByIdForLocale(kbId, locale, viewer)
        : await getPublicArticleBySlugForLocale(data.ref, locale, viewer)
      const { helpfulCount: _h, notHelpfulCount: _n, ...publicArticle } = serializeArticle(article)
      return { ...publicArticle, resolvedLocale: locale }
    } catch (err) {
      if (err instanceof NotFoundError) return null
      throw err
    }
  })
