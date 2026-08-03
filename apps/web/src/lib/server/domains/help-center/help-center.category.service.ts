import {
  db,
  helpCenterCategories,
  helpCenterArticles,
  eq,
  and,
  isNull,
  isNotNull,
  asc,
  sql,
  inArray,
} from '@/lib/server/db'
import type { HelpCenterCategoryId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { slugify } from '@/lib/shared/utils'
import { canActorViewCategory, type HelpCenterVisibilityActor } from './help-center.visibility'
import { uniqueHelpCenterSlug } from './help-center.slug'
import type {
  HelpCenterCategory,
  HelpCenterCategoryWithCount,
  CreateCategoryInput,
  UpdateCategoryInput,
} from './help-center.types'
import {
  MAX_CATEGORY_DEPTH,
  collectDescendantIdsIncludingSelf,
  computeRecursiveCounts,
  getCategoryDepth,
  getSubtreeMaxDepth,
} from './category-tree'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'help-center-categories' })

/**
 * Best-effort webhook dispatch for help-center category lifecycle events.
 * Mirrors the config-plane fire helpers (e.g. ticket-statuses.service): lazy
 * import, a `service` actor (these mutations carry no principal), and a
 * try/catch so a dispatch failure never aborts the mutation.
 */
async function fireCategoryEvent(
  kind: 'created' | 'updated' | 'deleted',
  category: HelpCenterCategory,
  changedFields?: string[]
): Promise<void> {
  try {
    const {
      dispatchHelpCenterCategoryCreated,
      dispatchHelpCenterCategoryUpdated,
      dispatchHelpCenterCategoryDeleted,
    } = await import('@/lib/server/events/dispatch')
    const actor = { type: 'service' as const, displayName: 'help-center-system' }
    const ref = {
      id: category.id,
      slug: category.slug,
      name: category.name,
      parentId: category.parentId ?? null,
      isPublic: category.isPublic,
      visibility: category.visibility ?? null,
      position: category.position,
      createdAt: category.createdAt ? category.createdAt.toISOString() : null,
      updatedAt: category.updatedAt ? category.updatedAt.toISOString() : null,
    }
    if (kind === 'created') await dispatchHelpCenterCategoryCreated(actor, ref)
    else if (kind === 'updated')
      await dispatchHelpCenterCategoryUpdated(actor, ref, changedFields ?? [])
    else await dispatchHelpCenterCategoryDeleted(actor, ref)
  } catch (err) {
    log.error({ err }, `failed to dispatch help_center.category.${kind} event`)
  }
}

function normalizeIdArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function normalizeCategoryAudience<
  T extends { allowedSegmentIds?: unknown; allowedPrincipalIds?: unknown },
>(category: T): T & { allowedSegmentIds: string[]; allowedPrincipalIds: string[] } {
  return {
    ...category,
    allowedSegmentIds: normalizeIdArray(category.allowedSegmentIds),
    allowedPrincipalIds: normalizeIdArray(category.allowedPrincipalIds),
  }
}

function validateTargetedAudience(input: {
  isPublic?: boolean
  visibility?: 'public' | 'targeted'
  allowedSegmentIds?: string[]
  allowedPrincipalIds?: string[]
}): void {
  if (input.isPublic === false) return
  if ((input.visibility ?? 'public') !== 'targeted') return
  const segmentCount = input.allowedSegmentIds?.length ?? 0
  const principalCount = input.allowedPrincipalIds?.length ?? 0
  if (segmentCount === 0 && principalCount === 0) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Targeted visibility requires at least one allowed segment or user'
    )
  }
}

// ============================================================================
// Categories
// ============================================================================

/**
 * Validate that placing a subtree (rooted at `movingId`, or null for a brand-new
 * category being created) under `newParentId` will not:
 * - create a cycle (new parent is self or a descendant)
 * - exceed MAX_CATEGORY_DEPTH for any node in the resulting subtree
 *
 * Callers must load the current full flat list of non-deleted categories.
 */
function validateHierarchyConstraint(params: {
  flat: Array<{ id: string; parentId: string | null }>
  movingId: string | null
  newParentId: string | null
}): void {
  const { flat, movingId, newParentId } = params

  if (newParentId === null) {
    if (movingId !== null) {
      const subtreeHeight = getSubtreeMaxDepth(flat, movingId)
      if (subtreeHeight + 1 > MAX_CATEGORY_DEPTH) {
        throw new ValidationError(
          'VALIDATION_ERROR',
          `Category subtree exceeds maximum depth of ${MAX_CATEGORY_DEPTH}`
        )
      }
    }
    return
  }

  if (movingId !== null && newParentId === movingId) {
    throw new ValidationError('VALIDATION_ERROR', 'A category cannot be its own parent')
  }

  if (movingId !== null) {
    const descendants = collectDescendantIdsIncludingSelf(flat, movingId)
    if (descendants.has(newParentId)) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'A category cannot be moved under its own descendant (cycle)'
      )
    }
  }

  const parentExists = flat.some((c) => c.id === newParentId)
  if (!parentExists) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Parent category ${newParentId} not found`)
  }

  const parentDepth = getCategoryDepth(flat, newParentId)
  const subtreeHeight = movingId === null ? 0 : getSubtreeMaxDepth(flat, movingId)
  if (parentDepth + 1 + subtreeHeight > MAX_CATEGORY_DEPTH - 1) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Placing this category here would exceed the maximum depth of ${MAX_CATEGORY_DEPTH}`
    )
  }
}

export async function listCategories(
  options: { showDeleted?: boolean } = {}
): Promise<HelpCenterCategoryWithCount[]> {
  const { showDeleted = false } = options
  const now = new Date()
  const nowIso = now.toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [categories, counts] = await Promise.all([
    db.query.helpCenterCategories.findMany({
      where: showDeleted
        ? and(
            isNotNull(helpCenterCategories.deletedAt),
            sql`${helpCenterCategories.deletedAt} >= ${thirtyDaysAgo}`
          )
        : isNull(helpCenterCategories.deletedAt),
      orderBy: [asc(helpCenterCategories.position), asc(helpCenterCategories.name)],
    }),
    showDeleted
      ? db
          .select({
            categoryId: helpCenterArticles.categoryId,
            totalCount: sql<number>`count(*)::int`.as('total_count'),
            publishedCount:
              sql<number>`count(*) filter (where ${helpCenterArticles.publishedAt} is not null and ${helpCenterArticles.publishedAt} <= ${nowIso})::int`.as(
                'published_count'
              ),
          })
          .from(helpCenterArticles)
          .where(
            and(
              isNotNull(helpCenterArticles.deletedAt),
              sql`${helpCenterArticles.deletedAt} >= ${thirtyDaysAgo}`
            )
          )
          .groupBy(helpCenterArticles.categoryId)
      : db
          .select({
            categoryId: helpCenterArticles.categoryId,
            totalCount: sql<number>`count(*)::int`.as('total_count'),
            publishedCount:
              sql<number>`count(*) filter (where ${helpCenterArticles.publishedAt} is not null and ${helpCenterArticles.publishedAt} <= ${nowIso})::int`.as(
                'published_count'
              ),
          })
          .from(helpCenterArticles)
          .where(isNull(helpCenterArticles.deletedAt))
          .groupBy(helpCenterArticles.categoryId),
  ])

  const countMap = new Map(
    counts.map((c) => [c.categoryId, { total: c.totalCount, published: c.publishedCount }])
  )

  const flat = categories.map((c) => ({ id: c.id, parentId: c.parentId ?? null }))
  const recursiveTotal = computeRecursiveCounts(
    flat,
    (id) => countMap.get(id as HelpCenterCategoryId)?.total ?? 0
  )
  const recursivePublished = computeRecursiveCounts(
    flat,
    (id) => countMap.get(id as HelpCenterCategoryId)?.published ?? 0
  )

  return categories.map((cat) => {
    const row = countMap.get(cat.id as HelpCenterCategoryId)
    return {
      ...cat,
      articleCount: row?.total ?? 0,
      publishedArticleCount: row?.published ?? 0,
      recursiveArticleCount: recursiveTotal.get(cat.id) ?? 0,
      recursivePublishedArticleCount: recursivePublished.get(cat.id) ?? 0,
    }
  })
}

export async function listPublicCategories(
  actor: HelpCenterVisibilityActor | null = null
): Promise<HelpCenterCategoryWithCount[]> {
  const all = await listCategories()
  return all
    .filter(
      (cat) =>
        cat.recursivePublishedArticleCount > 0 &&
        canActorViewCategory(normalizeCategoryAudience(cat), actor)
    )
    .map((cat) => ({ ...cat, articleCount: cat.recursivePublishedArticleCount }))
}

export async function getCategoryById(id: HelpCenterCategoryId): Promise<HelpCenterCategory> {
  const category = await db.query.helpCenterCategories.findFirst({
    where: and(eq(helpCenterCategories.id, id), isNull(helpCenterCategories.deletedAt)),
  })
  if (!category) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  }
  return normalizeCategoryAudience(category)
}

export async function getCategoryBySlug(slug: string): Promise<HelpCenterCategory> {
  const category = await db.query.helpCenterCategories.findFirst({
    where: and(eq(helpCenterCategories.slug, slug), isNull(helpCenterCategories.deletedAt)),
  })
  if (!category) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category with slug "${slug}" not found`)
  }
  return normalizeCategoryAudience(category)
}

/**
 * Public version of getCategoryBySlug: also requires the category to be
 * marked public. Routes that serve the unauthenticated help-center UI
 * must use this — otherwise an admin marking a category private hides
 * it from the nav but not from a direct-slug lookup.
 */
export async function getPublicCategoryBySlug(
  slug: string,
  actor: HelpCenterVisibilityActor | null = null
): Promise<HelpCenterCategory> {
  const category = await db.query.helpCenterCategories.findFirst({
    where: and(eq(helpCenterCategories.slug, slug), isNull(helpCenterCategories.deletedAt)),
  })
  if (!category || !canActorViewCategory(normalizeCategoryAudience(category), actor)) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category with slug "${slug}" not found`)
  }
  return normalizeCategoryAudience(category)
}

// Fallback slug base for category names that romanize to nothing (see
// uniqueHelpCenterSlug). 'category', 'category-2', ...
const FALLBACK_CATEGORY_SLUG = 'category'

const findCategorySlugConflict = (slug: string) =>
  db.query.helpCenterCategories.findFirst({
    where: eq(helpCenterCategories.slug, slug),
    columns: { id: true },
  })

export async function createCategory(input: CreateCategoryInput): Promise<HelpCenterCategory> {
  const name = input.name?.trim()
  if (!name) throw new ValidationError('VALIDATION_ERROR', 'Name is required')

  const slug = await uniqueHelpCenterSlug(
    input.slug?.trim() || slugify(name),
    FALLBACK_CATEGORY_SLUG,
    findCategorySlugConflict
  )

  validateTargetedAudience({
    isPublic: input.isPublic,
    visibility: input.visibility,
    allowedSegmentIds: input.allowedSegmentIds,
    allowedPrincipalIds: input.allowedPrincipalIds,
  })

  validateTargetedAudience({
    isPublic: input.isPublic,
    visibility: input.visibility,
    allowedSegmentIds: input.allowedSegmentIds,
    allowedPrincipalIds: input.allowedPrincipalIds,
  })

  if (input.parentId !== undefined && input.parentId !== null) {
    const flat = await db.query.helpCenterCategories.findMany({
      where: isNull(helpCenterCategories.deletedAt),
      columns: { id: true, parentId: true },
    })
    validateHierarchyConstraint({
      flat: flat as Array<{ id: string; parentId: string | null }>,
      movingId: null,
      newParentId: input.parentId as string,
    })
  }

  const [category] = await db
    .insert(helpCenterCategories)
    .values({
      name,
      slug,
      description: input.description?.trim() || null,
      isPublic: input.isPublic ?? true,
      visibility: input.visibility ?? 'public',
      allowedSegmentIds: input.allowedSegmentIds ?? [],
      allowedPrincipalIds: input.allowedPrincipalIds ?? [],
      position: input.position ?? 0,
      parentId: (input.parentId as HelpCenterCategoryId) ?? null,
      icon: input.icon ?? null,
    })
    .returning()

  const result = normalizeCategoryAudience(category)
  void fireCategoryEvent('created', result)
  return result
}

export async function updateCategory(
  id: HelpCenterCategoryId,
  input: UpdateCategoryInput
): Promise<HelpCenterCategory> {
  const current = await getCategoryById(id)
  const nextIsPublic = input.isPublic ?? current.isPublic
  const nextVisibility = input.visibility ?? current.visibility
  const nextAllowedSegmentIds = input.allowedSegmentIds ?? current.allowedSegmentIds
  const nextAllowedPrincipalIds = input.allowedPrincipalIds ?? current.allowedPrincipalIds

  validateTargetedAudience({
    isPublic: nextIsPublic,
    visibility: nextVisibility,
    allowedSegmentIds: nextAllowedSegmentIds,
    allowedPrincipalIds: nextAllowedPrincipalIds,
  })

  const updateData: Partial<typeof helpCenterCategories.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.slug !== undefined)
    updateData.slug = await uniqueHelpCenterSlug(
      input.slug.trim(),
      FALLBACK_CATEGORY_SLUG,
      findCategorySlugConflict,
      id
    )
  if (input.description !== undefined) updateData.description = input.description?.trim() || null
  if (input.isPublic !== undefined) updateData.isPublic = input.isPublic
  if (input.visibility !== undefined) updateData.visibility = input.visibility
  if (input.allowedSegmentIds !== undefined) updateData.allowedSegmentIds = input.allowedSegmentIds
  if (input.allowedPrincipalIds !== undefined)
    updateData.allowedPrincipalIds = input.allowedPrincipalIds
  if (input.position !== undefined) updateData.position = input.position
  if (input.icon !== undefined) updateData.icon = input.icon ?? null

  if (input.parentId !== undefined) {
    const flat = await db.query.helpCenterCategories.findMany({
      where: isNull(helpCenterCategories.deletedAt),
      columns: { id: true, parentId: true },
    })
    validateHierarchyConstraint({
      flat: flat as Array<{ id: string; parentId: string | null }>,
      movingId: id,
      newParentId: (input.parentId as string | null) ?? null,
    })
    updateData.parentId = (input.parentId as HelpCenterCategoryId) ?? null
  }

  const [updated] = await db
    .update(helpCenterCategories)
    .set(updateData)
    .where(and(eq(helpCenterCategories.id, id), isNull(helpCenterCategories.deletedAt)))
    .returning()

  if (!updated) throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  const result = normalizeCategoryAudience(updated)
  // Report the changed columns (drop the always-present updatedAt bump).
  const changedFields = Object.keys(updateData).filter((k) => k !== 'updatedAt')
  void fireCategoryEvent('updated', result, changedFields)
  return result
}

export async function deleteCategory(id: HelpCenterCategoryId): Promise<void> {
  const flat = await db.query.helpCenterCategories.findMany({
    where: isNull(helpCenterCategories.deletedAt),
    columns: { id: true, parentId: true },
  })
  if (!flat.some((c) => c.id === id)) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  }

  // Snapshot the target category before soft-deleting so the webhook ref
  // carries its display fields (the row's deletedAt is set by the tx below).
  // Best-effort: a failed snapshot read must never block the delete.
  const deletedCategory = await getCategoryById(id).catch(() => null)

  const toDelete = collectDescendantIdsIncludingSelf(
    flat as Array<{ id: string; parentId: string | null }>,
    id
  )
  const ids = [...toDelete] as HelpCenterCategoryId[]
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(helpCenterCategories)
      .set({ deletedAt: now })
      .where(and(inArray(helpCenterCategories.id, ids), isNull(helpCenterCategories.deletedAt)))
    await tx
      .update(helpCenterArticles)
      .set({ deletedAt: now })
      .where(and(inArray(helpCenterArticles.categoryId, ids), isNull(helpCenterArticles.deletedAt)))
  })

  if (deletedCategory) void fireCategoryEvent('deleted', deletedCategory)
}

export async function restoreCategory(id: HelpCenterCategoryId): Promise<HelpCenterCategory> {
  log.debug({ category_id: id }, 'restore category')
  const category = await db.query.helpCenterCategories.findFirst({
    where: eq(helpCenterCategories.id, id),
  })

  if (!category) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  }

  if (!category.deletedAt) {
    throw new ValidationError('VALIDATION_ERROR', 'Category is not deleted')
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  if (new Date(category.deletedAt) < thirtyDaysAgo) {
    throw new ValidationError(
      'RESTORE_EXPIRED',
      'Categories can only be restored within 30 days of deletion'
    )
  }

  // Refuse to restore a child under a still-deleted parent — it would keep
  // a non-null parentId to a hidden ancestor and drop out of the active
  // sidebar tree (which only roots from parentId === null). Admins must
  // restore the ancestor chain first.
  if (category.parentId) {
    const parent = await db.query.helpCenterCategories.findFirst({
      where: eq(helpCenterCategories.id, category.parentId),
      columns: { id: true, deletedAt: true },
    })
    if (parent?.deletedAt) {
      throw new ValidationError(
        'PARENT_DELETED',
        'Restore the parent category first, then restore this one.'
      )
    }
  }

  const [restored] = await db
    .update(helpCenterCategories)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(helpCenterCategories.id, id))
    .returning()

  if (!restored) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  }

  return normalizeCategoryAudience(restored)
}
