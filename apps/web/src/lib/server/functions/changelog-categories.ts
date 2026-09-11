/**
 * Server functions for changelog category (label) operations.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ChangelogCategoryId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { HEX_COLOR_PATTERN, TaxonomyNameSchema } from '@/lib/shared/schemas/taxonomy'
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
  name: TaxonomyNameSchema,
  color: z.string().regex(HEX_COLOR_PATTERN).optional().default('#6b7280'),
  segmentIds: z.array(z.string()).optional(),
})

const updateCategorySchema = z.object({
  id: z.string(),
  name: TaxonomyNameSchema.optional(),
  color: z.string().regex(HEX_COLOR_PATTERN).optional(),
  segmentIds: z.array(z.string()).optional(),
})

const idSchema = z.object({ id: z.string() })
const reorderSchema = z.object({ ids: z.array(z.string()) })

/** List categories (public: powers the widget/portal filter chips too). */
export const listChangelogCategoriesFn = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('list changelog categories')
  return await listChangelogCategories()
})

export const createChangelogCategoryFn = createServerFn({ method: 'POST' })
  .validator(createCategorySchema)
  .handler(async ({ data }) => {
    log.debug({ name: data.name }, 'create changelog category')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    return await createChangelogCategory(data)
  })

export const updateChangelogCategoryFn = createServerFn({ method: 'POST' })
  .validator(updateCategorySchema)
  .handler(async ({ data }) => {
    log.debug({ category_id: data.id }, 'update changelog category')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    return await updateChangelogCategory(data.id as ChangelogCategoryId, data)
  })

export const deleteChangelogCategoryFn = createServerFn({ method: 'POST' })
  .validator(idSchema)
  .handler(async ({ data }) => {
    log.debug({ category_id: data.id }, 'delete changelog category')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    await deleteChangelogCategory(data.id as ChangelogCategoryId)
    return { success: true }
  })

export const reorderChangelogCategoriesFn = createServerFn({ method: 'POST' })
  .validator(reorderSchema)
  .handler(async ({ data }) => {
    log.debug({ count: data.ids.length }, 'reorder changelog categories')
    await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })
    await reorderChangelogCategories(data.ids as ChangelogCategoryId[])
    return { success: true }
  })
