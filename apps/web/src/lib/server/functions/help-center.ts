/**
 * Server Functions for Help Center Operations
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type {
  HelpCenterCategoryId,
  HelpCenterArticleId,
  PrincipalId,
  SegmentId,
} from '@quackback/ids'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { requireAuth, getOptionalAuth } from './auth-helpers'
import { NotFoundError } from '@/lib/shared/errors'
import {
  listCategories,
  listPublicCategories,
  listPublicCategoryEditors,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  restoreCategory,
  listArticles,
  listPublicArticles,
  listPublicArticlesForCategory,
  getArticleById,
  getPublicArticleBySlug,
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
  restoreArticle,
  recordArticleFeedback,
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
  listPublicArticlesSchema,
  publishArticleSchema,
  unpublishArticleSchema,
  articleFeedbackSchema,
  getCategoryBySlugSchema,
  getArticleBySlugSchema,
  restoreCategorySchema,
  restoreArticleSchema,
} from '@/lib/shared/schemas/help-center'
import { z } from 'zod'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'
import { getWidgetRequestContext, type WidgetRequestContext } from '@/lib/server/widget/context'
import type { HelpCenterVisibilityActor } from '@/lib/server/domains/help-center/help-center.visibility'

import { logger } from '@/lib/server/logger'
const log = logger.child({ component: 'help-center' })
// ============================================================================
// Helper: serialize article dates
// ============================================================================

function serializeArticle<
  T extends { createdAt: Date; updatedAt: Date; publishedAt: Date | null; deletedAt?: Date | null },
>(article: T) {
  return {
    ...article,
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

async function getWidgetContextFromServerFnHeaders(): Promise<WidgetRequestContext> {
  const headers = getRequestHeaders()
  const request = new Request('https://widget-context.local/help', { headers })
  return getWidgetRequestContext(request)
}

function categoryAllowedByWidgetContext(
  category: { id: string },
  context: WidgetRequestContext
): boolean {
  if (!context.profileId) return true
  const allowedCategoryIds = new Set(context.contentFilters.help?.categoryIds ?? [])
  if (allowedCategoryIds.size === 0) return true
  return allowedCategoryIds.has(category.id as HelpCenterCategoryId)
}

function articleAllowedByWidgetContext(
  article: { id: string; categoryId?: string; category?: { id: string } },
  context: WidgetRequestContext
): boolean {
  if (!context.profileId) return true
  const helpFilters = context.contentFilters.help
  const allowedCategoryIds = new Set(helpFilters?.categoryIds ?? [])
  const allowedArticleIds = new Set(helpFilters?.articleIds ?? [])
  if (
    allowedCategoryIds.size > 0 &&
    !allowedCategoryIds.has(
      (article.categoryId ?? article.category?.id ?? '') as HelpCenterCategoryId
    )
  ) {
    return false
  }
  if (allowedArticleIds.size > 0 && !allowedArticleIds.has(article.id as HelpCenterArticleId)) {
    return false
  }
  return true
}

async function resolveHelpCenterActor(): Promise<HelpCenterVisibilityActor | null> {
  const auth = await getOptionalAuth()
  const principalId = auth?.principal?.id as PrincipalId | undefined
  if (!principalId) return null

  const { segmentIdsForPrincipal } =
    await import('@/lib/server/domains/segments/segment-membership.service')
  const segmentIds = await segmentIdsForPrincipal(principalId)
  return {
    principalId,
    segmentIds: segmentIds as ReadonlySet<SegmentId>,
  }
}

// ============================================================================
// Category Server Functions
// ============================================================================

export const listCategoriesFn = createServerFn({ method: 'GET' })
  .validator(listCategoriesSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const categories = await listCategories({ showDeleted: data.showDeleted })
    return categories.map(serializeCategory)
  })

export const listPublicCategoriesFn = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(async () => {
    const actor = await resolveHelpCenterActor()
    const categories = await listPublicCategories(actor)
    const widgetContext = await getWidgetContextFromServerFnHeaders()
    return categories
      .filter((category) => categoryAllowedByWidgetContext(category, widgetContext))
      .map(serializeCategory)
  })

export const getCategoryFn = createServerFn({ method: 'GET' })
  .validator(getCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const category = await getCategoryById(data.id as HelpCenterCategoryId)
    return serializeCategory(category)
  })

export const getPublicCategoryBySlugFn = createServerFn({ method: 'GET' })
  .validator(getCategoryBySlugSchema)
  .handler(async ({ data }) => {
    // Use the public variant so categories an admin marked private aren't
    // reachable by direct-slug lookup. The route serves unauthenticated
    // help-center traffic.
    const { getPublicCategoryBySlug } =
      await import('@/lib/server/domains/help-center/help-center.category.service')
    const actor = await resolveHelpCenterActor()
    const category = await getPublicCategoryBySlug(data.slug, actor)
    return serializeCategory(category)
  })

export const createCategoryFn = createServerFn({ method: 'POST' })
  .validator(createCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const category = await createCategory(data)
    return serializeCategory(category)
  })

export const updateCategoryFn = createServerFn({ method: 'POST' })
  .validator(updateCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const category = await updateCategory(data.id as HelpCenterCategoryId, data)
    return serializeCategory(category)
  })

export const deleteCategoryFn = createServerFn({ method: 'POST' })
  .validator(deleteCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    await deleteCategory(data.id as HelpCenterCategoryId)
    return { success: true }
  })

// ============================================================================
// Article Server Functions
// ============================================================================

export const listArticlesFn = createServerFn({ method: 'GET' })
  .validator(listArticlesSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const result = await listArticles(data)
    return {
      ...result,
      items: result.items.map(serializeArticle),
    }
  })

export const restoreCategoryFn = createServerFn({ method: 'POST' })
  .validator(restoreCategorySchema)
  .handler(async ({ data }) => {
    log.debug({ category_id: data.id }, 'restore category')
    try {
      await requireAuth({ roles: ['admin', 'member'] })
      const category = await restoreCategory(data.id as HelpCenterCategoryId)
      log.info({ category_id: category.id }, 'category restored')
      return serializeCategory(category)
    } catch (error) {
      log.error({ err: error }, 'restore category failed')
      throw error
    }
  })

export const restoreArticleFn = createServerFn({ method: 'POST' })
  .validator(restoreArticleSchema)
  .handler(async ({ data }) => {
    log.debug({ article_id: data.id }, 'restore article')
    try {
      await requireAuth({ roles: ['admin', 'member'] })
      const article = await restoreArticle(data.id as HelpCenterArticleId)
      log.info({ article_id: article.id }, 'article restored')
      return serializeArticle(article)
    } catch (error) {
      log.error({ err: error }, 'restore article failed')
      throw error
    }
  })

export const listPublicArticlesFn = createServerFn({ method: 'GET' })
  .validator(listPublicArticlesSchema)
  .handler(async ({ data }) => {
    const actor = await resolveHelpCenterActor()
    const result = await listPublicArticles(data, actor)
    const widgetContext = await getWidgetContextFromServerFnHeaders()
    const filteredItems = result.items.filter((article) =>
      articleAllowedByWidgetContext(article, widgetContext)
    )
    return {
      ...result,
      items: filteredItems.map(serializeArticle),
    }
  })

export const listPublicArticlesForCategoryFn = createServerFn({ method: 'GET' })
  .validator(z.object({ categoryId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await resolveHelpCenterActor()
    const widgetContext = await getWidgetContextFromServerFnHeaders()
    if (!categoryAllowedByWidgetContext({ id: data.categoryId }, widgetContext)) {
      return []
    }
    const articles = await listPublicArticlesForCategory(data.categoryId, actor)
    return articles
      .filter((article) =>
        articleAllowedByWidgetContext({ ...article, categoryId: data.categoryId }, widgetContext)
      )
      .map((a) => ({
        ...a,
        publishedAt: toIsoStringOrNull(a.publishedAt),
      }))
  })

export const listPublicCategoryEditorsFn = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(async () => {
    return listPublicCategoryEditors()
  })

export const getArticleFn = createServerFn({ method: 'GET' })
  .validator(getArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const article = await getArticleById(data.id as HelpCenterArticleId)
    return serializeArticle(article)
  })

export const getPublicArticleBySlugFn = createServerFn({ method: 'GET' })
  .validator(getArticleBySlugSchema)
  .handler(async ({ data }) => {
    const actor = await resolveHelpCenterActor()
    const article = await getPublicArticleBySlug(data.slug, actor)
    const widgetContext = await getWidgetContextFromServerFnHeaders()
    if (!articleAllowedByWidgetContext(article, widgetContext)) {
      throw new NotFoundError('ARTICLE_NOT_FOUND', `Article not found`)
    }
    const { helpfulCount: _h, notHelpfulCount: _n, ...publicArticle } = serializeArticle(article)
    return publicArticle
  })

export const createArticleFn = createServerFn({ method: 'POST' })
  .validator(createArticleSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member'] })
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
    await requireAuth({ roles: ['admin', 'member'] })
    const article = await updateArticle(data.id as HelpCenterArticleId, {
      ...data,
      contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : data.contentJson,
    })
    return serializeArticle(article)
  })

export const publishArticleFn = createServerFn({ method: 'POST' })
  .validator(publishArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const article = await publishArticle(data.id as HelpCenterArticleId)
    return serializeArticle(article)
  })

export const unpublishArticleFn = createServerFn({ method: 'POST' })
  .validator(unpublishArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const article = await unpublishArticle(data.id as HelpCenterArticleId)
    return serializeArticle(article)
  })

export const deleteArticleFn = createServerFn({ method: 'POST' })
  .validator(deleteArticleSchema)
  .handler(async ({ data }) => {
    // Soft delete (deleteArticle sets deletedAt) — team OK.
    await requireAuth({ roles: ['admin', 'member'] })
    await deleteArticle(data.id as HelpCenterArticleId)
    return { success: true }
  })

export const recordArticleFeedbackFn = createServerFn({ method: 'POST' })
  .validator(articleFeedbackSchema)
  .handler(async ({ data }) => {
    const auth = await getOptionalAuth()
    await recordArticleFeedback(
      data.articleId as HelpCenterArticleId,
      data.helpful,
      (auth?.principal?.id as PrincipalId) ?? null
    )
    return { success: true }
  })

// ============================================================================
// Public Hybrid Search
// ============================================================================

export const searchPublicArticlesFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(20).optional() })
  )
  .handler(async ({ data }) => {
    const { hybridSearch } =
      await import('@/lib/server/domains/help-center/help-center-search.service')
    return hybridSearch(data.query, data.limit ?? 10)
  })
