import {
  db,
  helpCenterCategories,
  helpCenterArticles,
  segments,
  eq,
  and,
  isNull,
  isNotNull,
  asc,
  sql,
  inArray,
} from '@/lib/server/db'
import type { KbCategoryId, SegmentId } from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import { segmentGateAllows } from '@/lib/server/policy/segment-gate'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { slugify } from '@/lib/shared/utils'
import { uniqueHelpCenterSlug } from './help-center.slug'
import { deleteRedirectRulesForTarget } from './help-center-redirect-rules.service'
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
    (id) => countMap.get(id as KbCategoryId)?.total ?? 0
  )
  const recursivePublished = computeRecursiveCounts(
    flat,
    (id) => countMap.get(id as KbCategoryId)?.published ?? 0
  )

  return categories.map((cat) => {
    const row = countMap.get(cat.id as KbCategoryId)
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
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterCategoryWithCount[]> {
  const all = await listCategories()
  return all
    .filter(
      (cat) =>
        cat.isPublic &&
        // Segment gate ([] = everyone) — same per-category semantics as the
        // article-side SQL predicate (helpCenterVisibilityConditions).
        segmentGateAllows(viewer, cat.segmentIds) &&
        cat.recursivePublishedArticleCount > 0
    )
    .map((cat) => ({ ...cat, articleCount: cat.recursivePublishedArticleCount }))
}

export async function getCategoryById(id: KbCategoryId): Promise<HelpCenterCategory> {
  const category = await db.query.helpCenterCategories.findFirst({
    where: and(eq(helpCenterCategories.id, id), isNull(helpCenterCategories.deletedAt)),
  })
  if (!category) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  }
  return category
}

export async function getCategoryBySlug(slug: string): Promise<HelpCenterCategory> {
  const category = await db.query.helpCenterCategories.findFirst({
    where: and(eq(helpCenterCategories.slug, slug), isNull(helpCenterCategories.deletedAt)),
  })
  if (!category) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category with slug "${slug}" not found`)
  }
  return category
}

/**
 * Public version of getCategoryBySlug: also requires the category to be
 * marked public. Routes that serve the unauthenticated help-center UI
 * must use this — otherwise an admin marking a category private hides
 * it from the nav but not from a direct-slug lookup.
 *
 * Deliberately not built on helpCenterVisibilityConditions (the shared
 * article predicate owner): this query has no article join, so only the
 * category-side conditions (not deleted, isPublic, segment gate) apply
 * here. Keep the category-side semantics in lockstep with that owner.
 *
 * A segment-gated category the viewer isn't a member of throws the same
 * NotFoundError shape as a genuinely missing slug, so gated content can't
 * be distinguished from nonexistent content.
 */
export async function getPublicCategoryBySlug(
  slug: string,
  viewer: Actor = ANONYMOUS_ACTOR
): Promise<HelpCenterCategory> {
  const category = await db.query.helpCenterCategories.findFirst({
    where: and(
      eq(helpCenterCategories.slug, slug),
      isNull(helpCenterCategories.deletedAt),
      eq(helpCenterCategories.isPublic, true)
    ),
  })
  if (!category || !segmentGateAllows(viewer, category.segmentIds)) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category with slug "${slug}" not found`)
  }
  return category
}

// Fallback slug base for category names that romanize to nothing (see
// uniqueHelpCenterSlug). 'category', 'category-2', ...
const FALLBACK_CATEGORY_SLUG = 'category'

const findCategorySlugConflict = (slug: string) =>
  db.query.helpCenterCategories.findFirst({
    where: eq(helpCenterCategories.slug, slug),
    columns: { id: true },
  })

/**
 * Validate a segment-gate list: every id must be an existing, non-deleted
 * segment. Returns the deduplicated list. Rejecting unknown ids (rather than
 * silently dropping them) surfaces admin typos and stale client state.
 */
async function validateSegmentIds(segmentIds: string[]): Promise<string[]> {
  const unique = [...new Set(segmentIds)]
  if (unique.length === 0) return []
  const rows = await db.query.segments.findMany({
    where: and(inArray(segments.id, unique as SegmentId[]), isNull(segments.deletedAt)),
    columns: { id: true },
  })
  const valid = new Set<string>(rows.map((r) => r.id))
  const unknown = unique.filter((id) => !valid.has(id))
  if (unknown.length > 0) {
    throw new ValidationError('VALIDATION_ERROR', `Unknown segment id(s): ${unknown.join(', ')}`)
  }
  return unique
}

export async function createCategory(input: CreateCategoryInput): Promise<HelpCenterCategory> {
  const name = input.name?.trim()
  if (!name) throw new ValidationError('VALIDATION_ERROR', 'Name is required')

  const slug = await uniqueHelpCenterSlug(
    input.slug?.trim() || slugify(name),
    FALLBACK_CATEGORY_SLUG,
    findCategorySlugConflict
  )

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
      segmentIds: input.segmentIds ? await validateSegmentIds(input.segmentIds) : [],
      position: input.position ?? 0,
      parentId: (input.parentId as KbCategoryId) ?? null,
      icon: input.icon ?? null,
    })
    .returning()

  return category
}

export async function updateCategory(
  id: KbCategoryId,
  input: UpdateCategoryInput
): Promise<HelpCenterCategory> {
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
  if (input.segmentIds !== undefined)
    updateData.segmentIds = await validateSegmentIds(input.segmentIds)
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
    updateData.parentId = (input.parentId as KbCategoryId) ?? null
  }

  const [updated] = await db
    .update(helpCenterCategories)
    .set(updateData)
    .where(and(eq(helpCenterCategories.id, id), isNull(helpCenterCategories.deletedAt)))
    .returning()

  if (!updated) throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  return updated
}

export async function deleteCategory(id: KbCategoryId): Promise<void> {
  const flat = await db.query.helpCenterCategories.findMany({
    where: isNull(helpCenterCategories.deletedAt),
    columns: { id: true, parentId: true },
  })
  if (!flat.some((c) => c.id === id)) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  }

  const toDelete = collectDescendantIdsIncludingSelf(
    flat as Array<{ id: string; parentId: string | null }>,
    id
  )
  const ids = [...toDelete] as KbCategoryId[]
  const now = new Date()

  const deletedArticleIds = await db.transaction(async (tx) => {
    await tx
      .update(helpCenterCategories)
      .set({ deletedAt: now })
      .where(and(inArray(helpCenterCategories.id, ids), isNull(helpCenterCategories.deletedAt)))
    const deletedArticles = await tx
      .update(helpCenterArticles)
      .set({ deletedAt: now })
      .where(and(inArray(helpCenterArticles.categoryId, ids), isNull(helpCenterArticles.deletedAt)))
      .returning({ id: helpCenterArticles.id })
    return deletedArticles.map((a) => a.id)
  })

  // No DB-level FK on redirect rules (polymorphic target) -- remove any rule
  // pointing at these categories or the articles cascaded with them
  // (domains/languages §2).
  await Promise.all([
    ...ids.map((categoryId) => deleteRedirectRulesForTarget('category', categoryId)),
    ...deletedArticleIds.map((articleId) => deleteRedirectRulesForTarget('article', articleId)),
  ])
}

export async function restoreCategory(id: KbCategoryId): Promise<HelpCenterCategory> {
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

  return restored
}
