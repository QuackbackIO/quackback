/**
 * Server Functions for Changelog Operations
 *
 * These functions handle changelog CRUD operations via TanStack Start server functions.
 */

import { createServerFn } from '@tanstack/react-start'
import type { BoardId, ChangelogCategoryId, ChangelogId, PostId } from '@quackback/ids'
// Note: BoardId is only used for searchShippedPosts filtering
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { NotFoundError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { requireAuth, getOptionalAuth, policyActorFromAuth } from './auth-helpers'
import { withErrorLog } from './with-error-log'
import { resolvePortalAccessForRequest } from './portal-access'
import {
  createChangelog,
  updateChangelog,
  deleteChangelog,
  getChangelogById,
} from '@/lib/server/domains/changelog/changelog.service'
import { listChangelogs, searchShippedPosts } from '@/lib/server/domains/changelog/changelog.query'
import {
  getPublicChangelogById,
  listPublicChangelogs,
} from '@/lib/server/domains/changelog/changelog.public'
import { isChangelogAudienceGranted } from '@/lib/server/domains/changelog/changelog.audience'
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
    return withErrorLog(log, 'create changelog', async () => {
      const auth = await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })

      // Get author name from user via member
      const authorName = auth.user.name

      const entry = await createChangelog(
        {
          title: data.title,
          content: data.content,
          contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : null,
          linkedPostIds: (data.linkedPostIds ?? []) as PostId[],
          categoryIds: data.categoryIds as ChangelogCategoryId[] | undefined,
          publishState: data.publishState as PublishState,
          ...(data.displayDate !== undefined && { displayDate: data.displayDate }),
          notify: data.notify,
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
        displayDate: toIsoStringOrNull(entry.displayDate),
      }
    })
  })

/**
 * Update an existing changelog entry
 */
export const updateChangelogFn = createServerFn({ method: 'POST' })
  .validator(updateChangelogSchema)
  .handler(async ({ data }) => {
    log.debug({ changelog_id: data.id }, 'update changelog')
    return withErrorLog(log, 'update changelog', async () => {
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })

      const entry = await updateChangelog(data.id as ChangelogId, {
        title: data.title,
        content: data.content,
        contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : undefined,
        linkedPostIds: data.linkedPostIds as PostId[] | undefined,
        categoryIds: data.categoryIds as ChangelogCategoryId[] | undefined,
        publishState: data.publishState as PublishState | undefined,
        ...(data.displayDate !== undefined && { displayDate: data.displayDate }),
        notify: data.notify,
      })

      return {
        ...entry,
        createdAt: toIsoString(entry.createdAt),
        updatedAt: toIsoString(entry.updatedAt),
        publishedAt: toIsoStringOrNull(entry.publishedAt),
        displayDate: toIsoStringOrNull(entry.displayDate),
      }
    })
  })

/**
 * Delete a changelog entry
 */
export const deleteChangelogFn = createServerFn({ method: 'POST' })
  .validator(deleteChangelogSchema)
  .handler(async ({ data }) => {
    log.debug({ changelog_id: data.id }, 'delete changelog')
    return withErrorLog(log, 'delete changelog', async () => {
      // Soft delete (sets deletedAt) — safe for members to perform.
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })

      await deleteChangelog(data.id as ChangelogId)

      return { success: true }
    })
  })

/**
 * Get a changelog entry by ID (admin view - includes drafts)
 */
export const getChangelogFn = createServerFn({ method: 'GET' })
  .validator(getChangelogSchema)
  .handler(async ({ data }) => {
    log.debug({ changelog_id: data.id }, 'get changelog')
    return withErrorLog(log, 'get changelog', async () => {
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_VIEW_DRAFT })

      const entry = await getChangelogById(data.id as ChangelogId)

      return {
        ...entry,
        createdAt: toIsoString(entry.createdAt),
        updatedAt: toIsoString(entry.updatedAt),
        publishedAt: toIsoStringOrNull(entry.publishedAt),
        displayDate: toIsoStringOrNull(entry.displayDate),
      }
    })
  })

/**
 * List changelog entries (admin view - includes drafts and scheduled)
 */
export const listChangelogsFn = createServerFn({ method: 'GET' })
  .validator(listChangelogsSchema)
  .handler(async ({ data }) => {
    log.debug({ status: data.status, limit: data.limit }, 'list changelogs')
    return withErrorLog(log, 'list changelogs', async () => {
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_VIEW_DRAFT })

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
          displayDate: toIsoStringOrNull(entry.displayDate),
        })),
      }
    })
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
    return withErrorLog(log, 'get public changelog', async () => {
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

      const authCtx = await getOptionalAuth()
      const actor = await policyActorFromAuth(authCtx)

      // Changelog audience gate (Settings > Changelog > Visibility): same
      // not-found shape as a missing entry when audience='authenticated'.
      if (!(await isChangelogAudienceGranted(actor))) {
        log.debug('changelog audience denied')
        throw new NotFoundError(
          'CHANGELOG_NOT_FOUND',
          `Published changelog entry with ID ${data.id} not found`
        )
      }

      const entry = await getPublicChangelogById(data.id as ChangelogId, actor)

      return {
        ...entry,
        publishedAt: toIsoString(entry.publishedAt),
      }
    })
  })

/**
 * List published changelog entries (public view)
 */
export const listPublicChangelogsFn = createServerFn({ method: 'GET' })
  .validator(listPublicChangelogsSchema)
  .handler(async ({ data }) => {
    log.debug({ limit: data.limit }, 'list public changelogs')
    return withErrorLog(log, 'list public changelogs', async () => {
      // Outer gate: private portal + unauthorized caller → no changelog entries.
      const access = await resolvePortalAccessForRequest()
      if (!access.granted) {
        log.debug('portal access denied, returning empty list')
        return { items: [], nextCursor: null, hasMore: false }
      }

      const authCtx = await getOptionalAuth()
      const actor = await policyActorFromAuth(authCtx)

      if (!(await isChangelogAudienceGranted(actor))) {
        log.debug('changelog audience denied, returning empty list')
        return { items: [], nextCursor: null, hasMore: false }
      }

      const result = await listPublicChangelogs(
        {
          cursor: data.cursor,
          limit: data.limit,
        },
        actor
      )

      return {
        ...result,
        items: result.items.map((entry) => ({
          ...entry,
          publishedAt: toIsoString(entry.publishedAt),
        })),
      }
    })
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
    return withErrorLog(log, 'search shipped posts', async () => {
      await requireAuth({ permission: PERMISSIONS.CHANGELOG_MANAGE })

      return searchShippedPosts({
        query: data.query,
        boardId: data.boardId as BoardId | undefined,
        limit: data.limit,
      })
    })
  })
