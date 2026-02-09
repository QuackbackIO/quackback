/**
 * Server Functions for Changelog Operations
 *
 * These functions handle changelog CRUD operations via TanStack Start server functions.
 */

import { createServerFn } from '@tanstack/react-start'
import type { BoardId, ChangelogId, PostId } from '@quackback/ids'
// Note: BoardId is only used for searchShippedPosts filtering
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { requireAuth } from './auth-helpers'
import {
  createChangelog,
  updateChangelog,
  deleteChangelog,
  getChangelogById,
  listChangelogs,
  getPublicChangelogById,
  listPublicChangelogs,
  searchShippedPosts,
  type PublishState,
} from '@/lib/server/domains/changelog'
import { z } from 'zod'
import {
  createChangelogSchema,
  updateChangelogSchema,
  listChangelogsSchema,
  getChangelogSchema,
  deleteChangelogSchema,
  listPublicChangelogsSchema,
} from '@/lib/shared/schemas/changelog'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Safely convert a date value to ISO string.
 */
function toIsoString(value: Date | string): string {
  if (typeof value === 'string') {
    return value
  }
  return value.toISOString()
}

/**
 * Safely convert an optional date value to ISO string or null.
 */
function toIsoStringOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null
  }
  return toIsoString(value)
}

// ============================================================================
// Admin Server Functions (Require Auth)
// ============================================================================

/**
 * Create a new changelog entry
 */
export const createChangelogFn = createServerFn({ method: 'POST' })
  .inputValidator(createChangelogSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin'] })

    // Get author name from user via member
    const authorName = auth.user.name

    const entry = await createChangelog(
      {
        title: data.title,
        content: data.content,
        contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : null,
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
  })

/**
 * Update an existing changelog entry
 */
export const updateChangelogFn = createServerFn({ method: 'POST' })
  .inputValidator(updateChangelogSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const entry = await updateChangelog(data.id as ChangelogId, {
      title: data.title,
      content: data.content,
      contentJson: data.contentJson ? sanitizeTiptapContent(data.contentJson) : undefined,
      linkedPostIds: data.linkedPostIds as PostId[] | undefined,
      publishState: data.publishState as PublishState | undefined,
    })

    return {
      ...entry,
      createdAt: toIsoString(entry.createdAt),
      updatedAt: toIsoString(entry.updatedAt),
      publishedAt: toIsoStringOrNull(entry.publishedAt),
    }
  })

/**
 * Delete a changelog entry
 */
export const deleteChangelogFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteChangelogSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    await deleteChangelog(data.id as ChangelogId)

    return { success: true }
  })

/**
 * Get a changelog entry by ID (admin view - includes drafts)
 */
export const getChangelogFn = createServerFn({ method: 'GET' })
  .inputValidator(getChangelogSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    const entry = await getChangelogById(data.id as ChangelogId)

    return {
      ...entry,
      createdAt: toIsoString(entry.createdAt),
      updatedAt: toIsoString(entry.updatedAt),
      publishedAt: toIsoStringOrNull(entry.publishedAt),
    }
  })

/**
 * List changelog entries (admin view - includes drafts and scheduled)
 */
export const listChangelogsFn = createServerFn({ method: 'GET' })
  .inputValidator(listChangelogsSchema)
  .handler(async ({ data }) => {
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
  })

// ============================================================================
// Public Server Functions (No Auth Required)
// ============================================================================

/**
 * Get a published changelog entry by ID (public view)
 */
export const getPublicChangelogFn = createServerFn({ method: 'GET' })
  .inputValidator(getChangelogSchema)
  .handler(async ({ data }) => {
    const entry = await getPublicChangelogById(data.id as ChangelogId)

    return {
      ...entry,
      publishedAt: toIsoString(entry.publishedAt),
    }
  })

/**
 * List published changelog entries (public view)
 */
export const listPublicChangelogsFn = createServerFn({ method: 'GET' })
  .inputValidator(listPublicChangelogsSchema)
  .handler(async ({ data }) => {
    const result = await listPublicChangelogs({
      cursor: data.cursor,
      limit: data.limit,
    })

    return {
      ...result,
      items: result.items.map((entry) => ({
        ...entry,
        publishedAt: toIsoString(entry.publishedAt),
      })),
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
  .inputValidator(searchShippedPostsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    return searchShippedPosts({
      query: data.query,
      boardId: data.boardId as BoardId | undefined,
      limit: data.limit,
    })
  })
