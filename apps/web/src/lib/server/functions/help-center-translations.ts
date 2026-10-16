/**
 * Server Functions for Help Center article/category translations (domains/languages §2)
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  upsertArticleTranslationSchema,
  setArticleTranslationStatusSchema,
  deleteArticleTranslationSchema,
  upsertCategoryTranslationSchema,
  deleteCategoryTranslationSchema,
} from '@/lib/shared/schemas/help-center'
import {
  listArticleTranslations,
  getArticleTranslationStatuses,
  upsertArticleTranslation,
  setArticleTranslationStatus,
  deleteArticleTranslation,
  listCategoryTranslations,
  getCategoryTranslationStatuses,
  upsertCategoryTranslation,
  deleteCategoryTranslation,
} from '@/lib/server/domains/help-center/help-center-translations.service'
import { getHelpCenterConfig } from '@/lib/server/domains/settings/settings.service'
import type { ArticleId, CategoryId } from '@quackback/ids'

// ============================================================================
// Article translations
// ============================================================================

export const listArticleTranslationsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ articleId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return listArticleTranslations(data.articleId as ArticleId)
  })

/** Status pill per enabled additional locale, for the editor's locale switcher. */
export const getArticleTranslationStatusesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ articleId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const { listPausedTranslationLocales } =
      await import('@/lib/server/domains/help-center/help-center-translate-queue')
    const [config, pausedLocales] = await Promise.all([
      getHelpCenterConfig(),
      listPausedTranslationLocales(data.articleId),
    ])
    return getArticleTranslationStatuses(
      data.articleId as ArticleId,
      config.locales.additional,
      pausedLocales
    )
  })

export const upsertArticleTranslationFn = createServerFn({ method: 'POST' })
  .validator(upsertArticleTranslationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return upsertArticleTranslation({ ...data, articleId: data.articleId as ArticleId })
  })

export const setArticleTranslationStatusFn = createServerFn({ method: 'POST' })
  .validator(setArticleTranslationStatusSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return setArticleTranslationStatus(data.articleId as ArticleId, data.locale, data.status)
  })

export const deleteArticleTranslationFn = createServerFn({ method: 'POST' })
  .validator(deleteArticleTranslationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    await deleteArticleTranslation(data.articleId as ArticleId, data.locale)
    return { success: true }
  })

// ============================================================================
// Category translations
// ============================================================================

export const listCategoryTranslationsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ categoryId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return listCategoryTranslations(data.categoryId as CategoryId)
  })

export const getCategoryTranslationStatusesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ categoryId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const config = await getHelpCenterConfig()
    return getCategoryTranslationStatuses(data.categoryId as CategoryId, config.locales.additional)
  })

export const upsertCategoryTranslationFn = createServerFn({ method: 'POST' })
  .validator(upsertCategoryTranslationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return upsertCategoryTranslation({ ...data, categoryId: data.categoryId as CategoryId })
  })

export const deleteCategoryTranslationFn = createServerFn({ method: 'POST' })
  .validator(deleteCategoryTranslationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    await deleteCategoryTranslation(data.categoryId as CategoryId, data.locale)
    return { success: true }
  })
