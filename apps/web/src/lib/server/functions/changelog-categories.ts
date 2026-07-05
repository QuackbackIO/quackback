/**
 * Server functions for changelog category (label) operations.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ChangelogCategoryId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  listChangelogCategories,
  createChangelogCategory,
  updateChangelogCategory,
  deleteChangelogCategory,
  reorderChangelogCategories,
} from '@/lib/server/domains/changelog/changelog-category.service'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'changelog-categories' })

const createCategorySchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .default('#6b7280'),
  segmentIds: z.array(z.string()).optional(),
})

const updateCategorySchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  segmentIds: z.array(z.string()).optional(),
})

const idSchema = z.object({ id: z.string() })
const reorderSchema = z.object({ ids: z.array(z.string()) })

/** List categories (public: powers the widget/portal filter chips too). */
export const listChangelogCategoriesFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list changelog categories')
  try {
    return await listChangelogCategories()
  } catch (error) {
    log.error({ err: error }, 'list changelog categories failed')
    throw error
  }
})

export const createChangelogCategoryFn = createServerFn({ method: 'POST' })
  .validator(createCategorySchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create changelog category')
    try {
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
      return await createChangelogCategory(data)
    } catch (error) {
      log.error({ err: error }, 'create changelog category failed')
      throw error
    }
  })

export const updateChangelogCategoryFn = createServerFn({ method: 'POST' })
  .validator(updateCategorySchema)
  .handler(async ({ data }) => {
    log.debug({ category_id: data.id }, 'update changelog category')
    try {
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
      return await updateChangelogCategory(data.id as ChangelogCategoryId, data)
    } catch (error) {
      log.error({ err: error }, 'update changelog category failed')
      throw error
    }
  })

export const deleteChangelogCategoryFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.debug({ category_id: data.id }, 'delete changelog category')
    try {
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
      await deleteChangelogCategory(data.id as ChangelogCategoryId)
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'delete changelog category failed')
      throw error
    }
  })

export const reorderChangelogCategoriesFn = createServerFn({ method: 'POST' })
  .validator(reorderSchema)
  .handler(async ({ data }) => {
    log.debug({ count: data.ids.length }, 'reorder changelog categories')
    try {
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
      await reorderChangelogCategories(data.ids as ChangelogCategoryId[])
      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'reorder changelog categories failed')
      throw error
    }
  })
