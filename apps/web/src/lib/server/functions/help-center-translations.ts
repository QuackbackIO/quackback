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
import type { KbArticleId, KbCategoryId } from '@quackback/ids'

// ============================================================================
// Article translations
// ============================================================================

export const listArticleTranslationsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ articleId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return listArticleTranslations(data.articleId as KbArticleId)
  })

/** Status pill per enabled additional locale, for the editor's locale switcher. */
export const getArticleTranslationStatusesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ articleId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const config = await getHelpCenterConfig()
    return getArticleTranslationStatuses(data.articleId as KbArticleId, config.locales.additional)
  })

export const upsertArticleTranslationFn = createServerFn({ method: 'POST' })
  .validator(upsertArticleTranslationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return upsertArticleTranslation({ ...data, articleId: data.articleId as KbArticleId })
  })

export const setArticleTranslationStatusFn = createServerFn({ method: 'POST' })
  .validator(setArticleTranslationStatusSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return setArticleTranslationStatus(data.articleId as KbArticleId, data.locale, data.status)
  })

export const deleteArticleTranslationFn = createServerFn({ method: 'POST' })
  .validator(deleteArticleTranslationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    await deleteArticleTranslation(data.articleId as KbArticleId, data.locale)
    return { success: true }
  })

// ============================================================================
// Category translations
// ============================================================================

export const listCategoryTranslationsFn = createServerFn({ method: 'GET' })
  .validator(z.object({ categoryId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return listCategoryTranslations(data.categoryId as KbCategoryId)
  })

export const getCategoryTranslationStatusesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ categoryId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    const config = await getHelpCenterConfig()
    return getCategoryTranslationStatuses(data.categoryId as KbCategoryId, config.locales.additional)
  })

export const upsertCategoryTranslationFn = createServerFn({ method: 'POST' })
  .validator(upsertCategoryTranslationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    return upsertCategoryTranslation({ ...data, categoryId: data.categoryId as KbCategoryId })
  })

export const deleteCategoryTranslationFn = createServerFn({ method: 'POST' })
  .validator(deleteCategoryTranslationSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.HELP_CENTER_MANAGE })
    await deleteCategoryTranslation(data.categoryId as KbCategoryId, data.locale)
    return { success: true }
  })
