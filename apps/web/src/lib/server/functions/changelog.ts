/**
 * Server Functions for Changelog Operations
 *
 * These functions handle changelog CRUD operations via TanStack Start server functions.
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import type {
  BoardId,
  ChangelogCategoryId,
  ChangelogId,
  ChangelogProductId,
  PostId,
} from '@quackback/ids'
// Note: BoardId is only used for searchShippedPosts filtering
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { NotFoundError } from '@/lib/shared/errors'
import { requireAuth, getOptionalAuth } from './auth-helpers'
import { resolvePortalAccessForRequest } from './portal-access'
import {
  createChangelog,
  updateChangelog,
  deleteChangelog,
  getChangelogById,
} from '@/lib/server/domains/changelog/changelog.service'
import {
  listChangelogs,
  listChangelogTaxonomy,
  searchShippedPosts,
} from '@/lib/server/domains/changelog/changelog.query'
import {
  getPublicChangelogById,
  listPublicChangelogs,
} from '@/lib/server/domains/changelog/changelog.public'
import type { PublishState } from '@/lib/server/domains/changelog'
import { z } from 'zod'
import {
  createChangelogSchema,
  updateChangelogSchema,
  listChangelogsSchema,
  getChangelogSchema,
  deleteChangelogSchema,
  listPublicChangelogsSchema,
} from '@/lib/shared/schemas/changelog'
import { toIsoString, toIsoStringOrNull } from '@/lib/shared/utils'
import { getWidgetRequestContext, type WidgetRequestContext } from '@/lib/server/widget/context'
import type { PublicChangelogEntry } from '@/lib/server/domains/changelog/changelog.types'

async function getWidgetContextFromServerFnHeaders(): Promise<WidgetRequestContext> {
  const headers = getRequestHeaders()
  const request = new Request('https://widget-context.local/changelog', { headers })
  return getWidgetRequestContext(request)
}

function applyWidgetChangelogFilters(
  entry: PublicChangelogEntry,
  context: WidgetRequestContext
): PublicChangelogEntry | null {
  if (!context.profileId) return entry

  const changelogFilter = context.contentFilters.changelog
  const mode = changelogFilter?.mode ?? 'all_published'

  const allowedCategoryIds = new Set(changelogFilter?.categoryIds ?? [])
  const allowedCategorySlugs = new Set(changelogFilter?.categorySlugs ?? [])
  const hasCategoryFilter = allowedCategoryIds.size > 0 || allowedCategorySlugs.size > 0
  if (hasCategoryFilter) {
    const category = entry.category
    if (
      !category ||
      (!allowedCategoryIds.has(category.id) && !allowedCategorySlugs.has(category.slug))
    ) {
      return null
    }
  }

  const allowedProductIds = new Set(changelogFilter?.productIds ?? [])
  const allowedProductSlugs = new Set(changelogFilter?.productSlugs ?? [])
  const hasProductFilter = allowedProductIds.size > 0 || allowedProductSlugs.size > 0
  if (hasProductFilter) {
    const product = entry.product
    if (
      !product ||
      (!allowedProductIds.has(product.id) && !allowedProductSlugs.has(product.slug))
    ) {
      return null
    }
  }

  if (mode === 'selected_entries') {
    const selectedIds = new Set(changelogFilter?.entryIds ?? [])
    return selectedIds.has(entry.id) ? entry : null
  }

  if (mode !== 'linked_to_allowed_feedback') return entry

  const feedbackFilter = context.contentFilters.feedback
  const allowedBoardIds = new Set(feedbackFilter?.boardIds ?? [])
  const allowedBoardSlugs = new Set(feedbackFilter?.boardSlugs ?? [])
  const allowedStatusIds = new Set(feedbackFilter?.statusIds ?? [])
  const hasBoardFilter = allowedBoardIds.size > 0 || allowedBoardSlugs.size > 0
  const hasStatusFilter = allowedStatusIds.size > 0
  const linkedPosts = entry.linkedPosts.filter((post) => {
    if (
      hasBoardFilter &&
      !allowedBoardIds.has(post.boardId) &&
      !allowedBoardSlugs.has(post.boardSlug)
    ) {
      return false
    }
    if (hasStatusFilter && (!post.statusId || !allowedStatusIds.has(post.statusId))) {
      return false
    }
    return true
  })

  return linkedPosts.length > 0 ? { ...entry, linkedPosts } : null
}

import { logger } from '@/lib/server/logger'
const log = logger.child({ component: 'changelog' })
// ============================================================================
// Admin Server Functions (Require Auth)
// ============================================================================

/**
 * Create a new changelog entry
 */
export const createChangelogFn = createServerFn({ method: 'POST' })
  .validator(createChangelogSchema)
  .handler(async ({ data }) => {
    log.debug({ title: data.title, publish_state: data.publishState }, 'create changelog')
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      // Get author name from user via member
      const authorName = auth.user.name

      const entry = await createChangelog(
        {
          title: data.title,
          content: data.content,
          contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : null,
          categoryId: data.categoryId as ChangelogCategoryId | null | undefined,
          categoryName: data.categoryName,
          productId: data.productId as ChangelogProductId | null | undefined,
          productName: data.productName,
          linkedPostIds: (data.linkedPostIds ?? []) as PostId[],
          publishState: data.publishState as PublishState,
        },
        {
          principalId: auth.principal.id,
          name: authorName,
        }
      )

      return {
        ...entry,
        createdAt: toIsoString(entry.createdAt),
        updatedAt: toIsoString(entry.updatedAt),
        publishedAt: toIsoStringOrNull(entry.publishedAt),
      }
    } catch (error) {
      log.error({ err: error }, 'create changelog failed')
      throw error
    }
  })

/**
 * Update an existing changelog entry
 */
export const updateChangelogFn = createServerFn({ method: 'POST' })
  .validator(updateChangelogSchema)
  .handler(async ({ data }) => {
    log.debug({ changelog_id: data.id }, 'update changelog')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const entry = await updateChangelog(data.id as ChangelogId, {
        title: data.title,
        content: data.content,
        contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : undefined,
        categoryId: data.categoryId as ChangelogCategoryId | null | undefined,
        categoryName: data.categoryName,
        productId: data.productId as ChangelogProductId | null | undefined,
        productName: data.productName,
        linkedPostIds: data.linkedPostIds as PostId[] | undefined,
        publishState: data.publishState as PublishState | undefined,
      })

      return {
        ...entry,
        createdAt: toIsoString(entry.createdAt),
        updatedAt: toIsoString(entry.updatedAt),
        publishedAt: toIsoStringOrNull(entry.publishedAt),
      }
    } catch (error) {
      log.error({ err: error }, 'update changelog failed')
      throw error
    }
  })

/**
 * Delete a changelog entry
 */
export const deleteChangelogFn = createServerFn({ method: 'POST' })
  .validator(deleteChangelogSchema)
  .handler(async ({ data }) => {
    log.debug({ changelog_id: data.id }, 'delete changelog')
    try {
      // Soft delete (sets deletedAt) — safe for members to perform.
      await requireAuth({ roles: ['admin', 'member'] })

      await deleteChangelog(data.id as ChangelogId)

      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'delete changelog failed')
      throw error
    }
  })

/**
 * Get a changelog entry by ID (admin view - includes drafts)
 */
export const getChangelogFn = createServerFn({ method: 'GET' })
  .validator(getChangelogSchema)
  .handler(async ({ data }) => {
    log.debug({ changelog_id: data.id }, 'get changelog')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const entry = await getChangelogById(data.id as ChangelogId)

      return {
        ...entry,
        createdAt: toIsoString(entry.createdAt),
        updatedAt: toIsoString(entry.updatedAt),
        publishedAt: toIsoStringOrNull(entry.publishedAt),
      }
    } catch (error) {
      log.error({ err: error }, 'get changelog failed')
      throw error
    }
  })

/**
 * List changelog entries (admin view - includes drafts and scheduled)
 */
export const listChangelogsFn = createServerFn({ method: 'GET' })
  .validator(listChangelogsSchema)
  .handler(async ({ data }) => {
    log.debug({ status: data.status, limit: data.limit }, 'list changelogs')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const result = await listChangelogs({
        status: data.status,
        cursor: data.cursor,
        limit: data.limit,
      })

      return {
        ...result,
        items: result.items.map((entry) => ({
          ...entry,
          createdAt: toIsoString(entry.createdAt),
          updatedAt: toIsoString(entry.updatedAt),
          publishedAt: toIsoStringOrNull(entry.publishedAt),
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'list changelogs failed')
      throw error
    }
  })

// ============================================================================
// Public Server Functions (No Auth Required)
// ============================================================================

/**
 * Get a published changelog entry by ID (public view)
 */
export const getPublicChangelogFn = createServerFn({ method: 'GET' })
  .validator(getChangelogSchema)
  .handler(async ({ data }) => {
    log.debug({ changelog_id: data.id }, 'get public changelog')
    try {
      // Outer gate: a private portal must not serve changelog content to a
      // caller the portal-access resolver denies. Throw the same not-found
      // error as a genuinely missing entry — a blocked visitor sees no data
      // and cannot distinguish a private entry from a non-existent one.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied')
        throw new NotFoundError(
          'CHANGELOG_NOT_FOUND',
          `Published changelog entry with ID ${data.id} not found`
        )
      }

      const entry = await getPublicChangelogById(data.id as ChangelogId)
      const widgetContext = await getWidgetContextFromServerFnHeaders()
      const filteredEntry = applyWidgetChangelogFilters(entry, widgetContext)
      if (!filteredEntry) {
        throw new NotFoundError(
          'CHANGELOG_NOT_FOUND',
          `Published changelog entry with ID ${data.id} not found`
        )
      }

      return {
        ...filteredEntry,
        publishedAt: toIsoString(filteredEntry.publishedAt),
      }
    } catch (error) {
      log.error({ err: error }, 'get public changelog failed')
      throw error
    }
  })

/**
 * List published changelog entries (public view)
 */
export const listPublicChangelogsFn = createServerFn({ method: 'GET' })
  .validator(listPublicChangelogsSchema)
  .handler(async ({ data }) => {
    log.debug({ limit: data.limit }, 'list public changelogs')
    try {
      // Outer gate: private portal + unauthorized caller → no changelog entries.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied, returning empty list')
        return { items: [], nextCursor: null, hasMore: false }
      }

      const widgetContext = await getWidgetContextFromServerFnHeaders()
      const changelogFilter = widgetContext.profileId
        ? widgetContext.contentFilters.changelog
        : undefined
      const mode = changelogFilter?.mode ?? 'all_published'
      const entryIds =
        mode === 'selected_entries'
          ? ((changelogFilter?.entryIds ?? []) as ChangelogId[])
          : undefined
      const categoryIds =
        (changelogFilter?.categoryIds?.length ?? 0) > 0
          ? (changelogFilter?.categoryIds as ChangelogCategoryId[])
          : undefined
      const productIds =
        (changelogFilter?.productIds?.length ?? 0) > 0
          ? (changelogFilter?.productIds as ChangelogProductId[])
          : undefined

      // Portal user-selected filters (from filter bar — single category/product)
      // Only applied when there's no widget-level category/product filter overriding
      const portalCategoryId =
        !categoryIds && data.selectedCategoryId
          ? [data.selectedCategoryId as ChangelogCategoryId]
          : categoryIds
      const portalProductId =
        !productIds && data.selectedProductId
          ? [data.selectedProductId as ChangelogProductId]
          : productIds

      const result = await listPublicChangelogs({
        cursor: data.cursor,
        limit: data.limit,
        entryIds,
        categoryIds: portalCategoryId,
        productIds: portalProductId,
        visibilityCategoryIds: (data.visibilityCategoryIds as ChangelogCategoryId[]) ?? null,
        visibilityProductIds: (data.visibilityProductIds as ChangelogProductId[]) ?? null,
      })

      const filteredItems = result.items
        .map((entry) => applyWidgetChangelogFilters(entry, widgetContext))
        .filter((entry): entry is PublicChangelogEntry => entry !== null)

      return {
        ...result,
        items: filteredItems.map((entry) => ({
          ...entry,
          publishedAt: toIsoString(entry.publishedAt),
        })),
      }
    } catch (error) {
      log.error({ err: error }, 'list public changelogs failed')
      throw error
    }
  })

export const listChangelogTaxonomyFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin', 'member'] })
  return listChangelogTaxonomy()
})

/**
 * List changelog categories and products for public portal view.
 * Used by the portal filter bar. Respects portal access gate.
 */
export const listPublicChangelogTaxonomyFn = createServerFn({ method: 'GET' }).handler(async () => {
  const access = await resolvePortalAccessForRequest()
  if (!access.granted) {
    return { categories: [], products: [] }
  }
  return listChangelogTaxonomy()
})

// ============================================================================
// Changelog Visibility Configuration (Category/Product Access Control)
// ============================================================================

const changelogVisibilityConfigSchema = z.object({
  restrictCategories: z.boolean().optional(),
  allowedCategoryIds: z.array(z.string()).optional(),
  restrictProducts: z.boolean().optional(),
  allowedProductIds: z.array(z.string()).optional(),
})

const segmentChangelogVisibilitySchema = z.object({
  segmentId: z.string(),
  restrictCategories: z.boolean().optional(),
  allowedCategoryIds: z.array(z.string()).optional(),
  restrictProducts: z.boolean().optional(),
  allowedProductIds: z.array(z.string()).optional(),
})

/**
 * Get the effective changelog visibility for the current portal user.
 * Returns allowedCategoryIds / allowedProductIds (null = unrestricted).
 */
export const getChangelogVisibilityForCurrentUserFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const auth = await getOptionalAuth()
    if (!auth?.user?.id) {
      // Unauthenticated users see everything (visibility is additive for logged-in users only)
      return { allowedCategoryIds: null, allowedProductIds: null }
    }
    const { getEffectiveChangelogVisibilityForUser } =
      await import('@/lib/server/domains/changelog/changelog-visibility.service')
    return getEffectiveChangelogVisibilityForUser(auth.user.id as any)
  }
)

/**
 * Admin: get org-level changelog visibility config + all segment overrides + taxonomy.
 */
export const getChangelogVisibilityAdminFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin'] })
  const { getOrgChangelogVisibility, getAllSegmentChangelogVisibilities } =
    await import('@/lib/server/domains/changelog/changelog-visibility.service')
  const { listChangelogTaxonomy } = await import('@/lib/server/domains/changelog/changelog.query')
  const [orgConfig, segmentVisibilities, taxonomy] = await Promise.all([
    getOrgChangelogVisibility(),
    getAllSegmentChangelogVisibilities(),
    listChangelogTaxonomy(),
  ])
  return { orgConfig, segmentVisibilities, taxonomy }
})

/**
 * Admin: update org-level changelog visibility defaults.
 */
export const updateOrgChangelogVisibilityFn = createServerFn({ method: 'POST' })
  .validator(changelogVisibilityConfigSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const { setOrgChangelogVisibility } =
      await import('@/lib/server/domains/changelog/changelog-visibility.service')
    await setOrgChangelogVisibility(data)
    return { success: true }
  })

/**
 * Admin: update per-segment changelog visibility overrides.
 */
export const updateSegmentChangelogVisibilityFn = createServerFn({ method: 'POST' })
  .validator(segmentChangelogVisibilitySchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const { setSegmentChangelogVisibility } =
      await import('@/lib/server/domains/changelog/changelog-visibility.service')
    const { segmentId, ...config } = data
    await setSegmentChangelogVisibility(segmentId as any, config)
    return { success: true }
  })

/**
 * Admin: delete per-segment changelog visibility override (revert to org defaults).
 */
export const deleteSegmentChangelogVisibilityFn = createServerFn({ method: 'POST' })
  .validator(z.object({ segmentId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })
    const { deleteSegmentChangelogVisibility } =
      await import('@/lib/server/domains/changelog/changelog-visibility.service')
    await deleteSegmentChangelogVisibility(data.segmentId as any)
    return { success: true }
  })

// ============================================================================
// Shipped Posts Search (for linking)
// ============================================================================

const searchShippedPostsSchema = z.object({
  query: z.string().optional(),
  boardId: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
})

/**
 * Search posts with status category 'complete' for linking to changelogs
 */
export const searchShippedPostsFn = createServerFn({ method: 'GET' })
  .validator(searchShippedPostsSchema)
  .handler(async ({ data }) => {
    log.debug({ query: data.query, board_id: data.boardId }, 'search shipped posts')
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      return searchShippedPosts({
        query: data.query,
        boardId: data.boardId as BoardId | undefined,
        limit: data.limit,
      })
    } catch (error) {
      log.error({ err: error }, 'search shipped posts failed')
      throw error
    }
  })
