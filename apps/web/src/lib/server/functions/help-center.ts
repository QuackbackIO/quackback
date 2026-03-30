/**
 * Server Functions for Help Center Operations
 */

import { createServerFn } from '@tanstack/react-start'
import type { HelpCenterCategoryId, HelpCenterArticleId, PrincipalId } from '@quackback/ids'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { requireAuth } from './auth-helpers'
import {
  listCategories,
  listPublicCategories,
  getCategoryById,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
  listArticles,
  listPublicArticles,
  getArticleById,
  getPublicArticleBySlug,
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
  recordArticleFeedback,
} from '@/lib/server/domains/help-center/help-center.service'
import {
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
} from '@/lib/shared/schemas/help-center'
import { z } from 'zod'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'

// ============================================================================
// Helper: serialize article dates
// ============================================================================

function serializeArticle<T extends { createdAt: Date; updatedAt: Date; publishedAt: Date | null }>(
  article: T
) {
  return {
    ...article,
    createdAt: toIsoString(article.createdAt),
    updatedAt: toIsoString(article.updatedAt),
    publishedAt: toIsoStringOrNull(article.publishedAt),
  }
}

function serializeCategory<T extends { createdAt: Date; updatedAt: Date }>(cat: T) {
  return {
    ...cat,
    createdAt: toIsoString(cat.createdAt),
    updatedAt: toIsoString(cat.updatedAt),
  }
}

// ============================================================================
// Category Server Functions
// ============================================================================

export const listCategoriesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({}))
  .handler(async () => {
    await requireAuth({ roles: ['admin', 'member'] })
    const categories = await listCategories()
    return categories.map(serializeCategory)
  })

export const listPublicCategoriesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({}))
  .handler(async () => {
    const categories = await listPublicCategories()
    return categories.map(serializeCategory)
  })

export const getCategoryFn = createServerFn({ method: 'GET' })
  .inputValidator(getCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const category = await getCategoryById(data.id as HelpCenterCategoryId)
    return serializeCategory(category)
  })

export const getPublicCategoryBySlugFn = createServerFn({ method: 'GET' })
  .inputValidator(getCategoryBySlugSchema)
  .handler(async ({ data }) => {
    const category = await getCategoryBySlug(data.slug)
    return serializeCategory(category)
  })

export const createCategoryFn = createServerFn({ method: 'POST' })
  .inputValidator(createCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const category = await createCategory(data)
    return serializeCategory(category)
  })

export const updateCategoryFn = createServerFn({ method: 'POST' })
  .inputValidator(updateCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const category = await updateCategory(data.id as HelpCenterCategoryId, data)
    return serializeCategory(category)
  })

export const deleteCategoryFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteCategorySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    await deleteCategory(data.id as HelpCenterCategoryId)
    return { success: true }
  })

// ============================================================================
// Article Server Functions
// ============================================================================

export const listArticlesFn = createServerFn({ method: 'GET' })
  .inputValidator(listArticlesSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const result = await listArticles(data)
    return {
      ...result,
      items: result.items.map(serializeArticle),
    }
  })

export const listPublicArticlesFn = createServerFn({ method: 'GET' })
  .inputValidator(listPublicArticlesSchema)
  .handler(async ({ data }) => {
    const result = await listPublicArticles(data)
    return {
      ...result,
      items: result.items.map(serializeArticle),
    }
  })

export const getArticleFn = createServerFn({ method: 'GET' })
  .inputValidator(getArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    const article = await getArticleById(data.id as HelpCenterArticleId)
    return serializeArticle(article)
  })

export const getPublicArticleBySlugFn = createServerFn({ method: 'GET' })
  .inputValidator(getArticleBySlugSchema)
  .handler(async ({ data }) => {
    const article = await getPublicArticleBySlug(data.slug)
    return serializeArticle(article)
  })

export const createArticleFn = createServerFn({ method: 'POST' })
  .inputValidator(createArticleSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })
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
  .inputValidator(updateArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const article = await updateArticle(data.id as HelpCenterArticleId, {
      ...data,
      contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : data.contentJson,
    })
    return serializeArticle(article)
  })

export const publishArticleFn = createServerFn({ method: 'POST' })
  .inputValidator(publishArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const article = await publishArticle(data.id as HelpCenterArticleId)
    return serializeArticle(article)
  })

export const unpublishArticleFn = createServerFn({ method: 'POST' })
  .inputValidator(unpublishArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const article = await unpublishArticle(data.id as HelpCenterArticleId)
    return serializeArticle(article)
  })

export const deleteArticleFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteArticleSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    await deleteArticle(data.id as HelpCenterArticleId)
    return { success: true }
  })

export const recordArticleFeedbackFn = createServerFn({ method: 'POST' })
  .inputValidator(articleFeedbackSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member'] })
    await recordArticleFeedback(
      data.articleId as HelpCenterArticleId,
      data.helpful,
      auth.principal.id as PrincipalId
    )
    return { success: true }
  })
