/**
 * Server functions for changelog category (label) operations.
 */

import { z } from 'zod'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import type { ChangelogCategoryId } from '@quackback/ids'
import { requireAuth, getOptionalAuth, policyActorFromAuth } from './auth-helpers'
import { resolveChangelogReader } from './changelog'
import { isTeamActor } from '@/lib/server/policy/types'
import { segmentGateAllows } from '@/lib/server/policy/segment-gate'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  EntityIdSchema,
  OptionalHexColorPatternSchema,
  OptionalHexColorPatternWithDefaultSchema,
  ReorderIdsOpenSchema,
  TaxonomyNameSchema,
} from '@/lib/shared/schemas/taxonomy'
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
  color: OptionalHexColorPatternWithDefaultSchema,
  segmentIds: z.array(z.string()).optional(),
})

const updateCategorySchema = z.object({
  id: z.string(),
  name: TaxonomyNameSchema.optional(),
  color: OptionalHexColorPatternSchema,
  segmentIds: z.array(z.string()).optional(),
})

const idSchema = EntityIdSchema
const reorderSchema = ReorderIdsOpenSchema

/**
 * The labels a caller may see. The team gets every label with the segments it
 * is gated to (the editor and the Labels settings card). Anyone else gets
 * what the public changelog would show them: nothing when it is closed to
 * them, else the labels they could see on an entry, and never which segments
 * a label is for. The portal and widget filter chips are built from it.
 */
export const runListChangelogCategories = createServerOnlyFn(
  async function runListChangelogCategories(authCtx: Awaited<ReturnType<typeof getOptionalAuth>>) {
    log.debug('list changelog categories')
    if (isTeamActor(await policyActorFromAuth(authCtx))) return await listChangelogCategories()
    const reader = await resolveChangelogReader(authCtx)
    if (!reader) return []
    const categories = await listChangelogCategories()
    return categories
      .filter((category) => segmentGateAllows(reader, category.segmentIds))
      .map((category) => ({ ...category, segmentIds: [] }))
  }
)

export const listChangelogCategoriesFn = createServerFn({ method: 'GET' }).handler(async () =>
  runListChangelogCategories(await getOptionalAuth())
)

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
