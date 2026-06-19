/**
 * Server Functions for Changelog Operations
 *
 * These functions handle changelog CRUD operations via TanStack Start server functions.
 */

import { createServerFn } from '@tanstack/react-start'
import type { BoardId, ChangelogId, PostId } from '@quackback/ids'
// Note: BoardId is only used for searchShippedPosts filtering
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { NotFoundError } from '@/lib/shared/errors'
import {
  requireAuth,
  getOptionalAuth,
  hasAuthCredentials,
  policyActorFromAuth,
} from './auth-helpers'
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
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      // Get author name from user via member
      const authorName = auth.user.name

      const entry = await createChangelog(
        {
          title: data.title,
          content: data.content,
          contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : null,
          linkedPostIds: (data.linkedPostIds ?? []) as PostId[],
          publishState: data.publishState as PublishState,
          access: data.access,
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
        linkedPostIds: data.linkedPostIds as PostId[] | undefined,
        publishState: data.publishState as PublishState | undefined,
        access: data.access,
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

      // Resolve the actor so segment-restricted entries surface only to the
      // right viewers (the gate above only decides portal entry).
      const auth = hasAuthCredentials() ? await getOptionalAuth() : null
      const actor = await policyActorFromAuth(auth)

      const entry = await getPublicChangelogById(data.id as ChangelogId, actor)

      return {
        ...entry,
        publishedAt: toIsoString(entry.publishedAt),
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

      const auth = hasAuthCredentials() ? await getOptionalAuth() : null
      const actor = await policyActorFromAuth(auth)

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
    } catch (error) {
      log.error({ err: error }, 'list public changelogs failed')
      throw error
    }
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
