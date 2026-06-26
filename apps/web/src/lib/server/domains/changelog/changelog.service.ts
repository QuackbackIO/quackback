/**
 * Changelog Service - Core CRUD operations
 *
 * This service handles changelog entry operations:
 * - Create, update, delete changelog entries
 * - List and get changelog entries
 * - Link/unlink posts to changelog entries
 * - Publish, schedule, and unpublish entries
 */

import {
  db,
  changelogEntries,
  changelogEntryPosts,
  posts,
  principal,
  postStatuses,
  eq,
  and,
  isNull,
  inArray,
} from '@/lib/server/db'
import type { ChangelogId, PrincipalId, PostId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
import { buildEventActor, dispatchChangelogPublished } from '@/lib/server/events/dispatch'
import { scheduleDispatch, cancelScheduledDispatch } from '@/lib/server/events/scheduler'
import { logger } from '@/lib/server/logger'

import { isSameDay } from 'date-fns'
import type {
  CreateChangelogInput,
  UpdateChangelogInput,
  ChangelogEntryWithDetails,
  PublishState,
  ChangelogAuthor,
  ChangelogLinkedPost,
} from './changelog.types'

const log = logger.child({ component: 'changelog' })

// ============================================================================
// Create
// ============================================================================

/**
 * Create a new changelog entry
 *
 * @param input - Changelog creation data
 * @param author - Author information
 * @returns Created changelog entry with details
 */
export async function createChangelog(
  input: CreateChangelogInput,
  author: { principalId: PrincipalId; name: string }
): Promise<ChangelogEntryWithDetails> {
  // Validate input
  const title = input.title?.trim()
  const content = input.content?.trim()

  if (!title) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  if (!content) {
    throw new ValidationError('VALIDATION_ERROR', 'Content is required')
  }
  if (title.length > 200) {
    throw new ValidationError('VALIDATION_ERROR', 'Title must not exceed 200 characters')
  }

  // Determine publishedAt based on publish state
  const publishedAt = getPublishedAtFromState(input.publishState)

  if (input.displayDate != null) {
    if (input.publishState.type !== 'published') {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'Display date can only be set on published changelog entries'
      )
    }
    validateDisplayDate(publishedAt, input.displayDate)
  }

  const displayDate =
    input.displayDate != null && input.publishState.type === 'published'
      ? normalizeDisplayDate(input.displayDate, publishedAt)
      : null

  // Create the changelog entry
  const parsedContentJson = input.contentJson ?? markdownToTiptapJson(content)
  const contentJson = await rehostExternalImages(parsedContentJson, {
    contentType: 'changelog',
    principalId: author.principalId,
  })

  const [entry] = await db
    .insert(changelogEntries)
    .values({
      title,
      content,
      contentJson,
      principalId: author.principalId,
      publishedAt,
      ...(displayDate != null && { displayDate }),
    })
    .returning()

  // Link posts if provided
  if (input.linkedPostIds && input.linkedPostIds.length > 0) {
    await linkPostsToChangelog(entry.id, input.linkedPostIds)
  }

  // Dispatch event or schedule delayed job based on publish state
  const actor = buildEventActor({ principalId: author.principalId })
  if (input.publishState.type === 'published') {
    dispatchChangelogPublished(actor, {
      id: entry.id,
      title: entry.title,
      contentPreview: entry.content.slice(0, 200),
      publishedAt: publishedAt!,
      linkedPostCount: input.linkedPostIds?.length ?? 0,
    }).catch((err) => log.error({ err }, 'failed to dispatch changelog published event'))
  } else if (input.publishState.type === 'scheduled' && publishedAt) {
    const delayMs = publishedAt.getTime() - Date.now()
    if (delayMs > 0) {
      scheduleDispatch({
        jobId: `changelog-publish--${entry.id}`,
        handler: '__changelog_publish__',
        delayMs,
        payload: { changelogId: entry.id, principalId: author.principalId },
        actor,
      }).catch((err) => log.error({ err }, 'failed to schedule changelog publish job'))
    }
  }

  // Return with details
  return getChangelogById(entry.id)
}

// ============================================================================
// Update
// ============================================================================

/**
 * Update an existing changelog entry
 *
 * @param id - Changelog entry ID
 * @param input - Update data
 * @returns Updated changelog entry with details
 */
export async function updateChangelog(
  id: ChangelogId,
  input: UpdateChangelogInput
): Promise<ChangelogEntryWithDetails> {
  // Get existing entry (exclude soft-deleted)
  const existing = await db.query.changelogEntries.findFirst({
    where: and(eq(changelogEntries.id, id), isNull(changelogEntries.deletedAt)),
  })
  if (!existing) {
    throw new NotFoundError('CHANGELOG_NOT_FOUND', `Changelog entry with ID ${id} not found`)
  }

  // Validate input
  if (input.title !== undefined) {
    if (!input.title.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Title cannot be empty')
    }
    if (input.title.length > 200) {
      throw new ValidationError('VALIDATION_ERROR', 'Title must be 200 characters or less')
    }
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (input.title !== undefined) updateData.title = input.title.trim()
  if (input.content !== undefined) updateData.content = input.content.trim()
  if (input.contentJson !== undefined || input.content !== undefined) {
    const parsed = input.contentJson ?? markdownToTiptapJson((input.content ?? '').trim())
    updateData.contentJson = await rehostExternalImages(parsed, {
      contentType: 'changelog',
      principalId: existing.principalId ?? undefined,
    })
  }

  if (input.displayDate !== undefined) {
    validateDisplayDate(existing.publishedAt, input.displayDate)
    const publishedAtRef =
      input.publishState !== undefined
        ? getPublishedAtFromState(input.publishState)
        : existing.publishedAt
    updateData.displayDate = normalizeDisplayDate(input.displayDate, publishedAtRef)
  }

  // Handle publish state change
  if (input.publishState !== undefined) {
    updateData.publishedAt = getPublishedAtFromState(input.publishState)
  }

  // Update the entry
  await db.update(changelogEntries).set(updateData).where(eq(changelogEntries.id, id))

  // Update linked posts if provided
  if (input.linkedPostIds !== undefined) {
    // Remove all existing links
    await db.delete(changelogEntryPosts).where(eq(changelogEntryPosts.changelogEntryId, id))

    // Add new links
    if (input.linkedPostIds.length > 0) {
      await linkPostsToChangelog(id, input.linkedPostIds)
    }
  }

  // Handle event dispatch / scheduling when publish state changes
  if (input.publishState !== undefined) {
    const jobId = `changelog-publish--${id}`
    const actor = existing.principalId
      ? buildEventActor({ principalId: existing.principalId })
      : { type: 'service' as const, displayName: 'system' }

    if (input.publishState.type === 'published') {
      // Cancel any pending scheduled job, then dispatch immediately
      cancelScheduledDispatch(jobId).catch(() => {})
      const updated = await getChangelogById(id)
      dispatchChangelogPublished(actor, {
        id,
        title: updated.title,
        contentPreview: updated.content.slice(0, 200),
        publishedAt: new Date(),
        linkedPostCount: updated.linkedPosts.length,
      }).catch((err) => log.error({ err }, 'failed to dispatch changelog published event'))
    } else if (input.publishState.type === 'scheduled') {
      const newPublishedAt = getPublishedAtFromState(input.publishState)
      if (newPublishedAt) {
        const delayMs = newPublishedAt.getTime() - Date.now()
        if (delayMs > 0) {
          scheduleDispatch({
            jobId,
            handler: '__changelog_publish__',
            delayMs,
            payload: { changelogId: id, principalId: existing.principalId },
            actor,
          }).catch((err) => log.error({ err }, 'failed to schedule changelog publish job'))
        }
      }
    } else if (input.publishState.type === 'draft') {
      cancelScheduledDispatch(jobId).catch(() => {})
    }
  }

  return getChangelogById(id)
}

// ============================================================================
// Delete
// ============================================================================

/**
 * Soft delete a changelog entry. publishedAt is preserved so cursor
 * pagination in public read paths still has a valid anchor when the
 * cursor row gets deleted mid-session. Visibility is enforced by the
 * shared `publicChangelogConditions` helper, which every public read
 * uses to filter out `deletedAt IS NOT NULL` rows.
 *
 * @param id - Changelog entry ID
 */
export async function deleteChangelog(id: ChangelogId): Promise<void> {
  const result = await db
    .update(changelogEntries)
    .set({ deletedAt: new Date() })
    .where(and(eq(changelogEntries.id, id), isNull(changelogEntries.deletedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('CHANGELOG_NOT_FOUND', `Changelog entry with ID ${id} not found`)
  }
}

// ============================================================================
// Read
// ============================================================================

/**
 * Get a changelog entry by ID with full details
 *
 * @param id - Changelog entry ID
 * @returns Changelog entry with details
 */
export async function getChangelogById(id: ChangelogId): Promise<ChangelogEntryWithDetails> {
  // Get the changelog entry (exclude soft-deleted)
  const entry = await db.query.changelogEntries.findFirst({
    where: and(eq(changelogEntries.id, id), isNull(changelogEntries.deletedAt)),
  })

  if (!entry) {
    throw new NotFoundError('CHANGELOG_NOT_FOUND', `Changelog entry with ID ${id} not found`)
  }

  // Get author info from principal's display fields
  let author: ChangelogAuthor | null = null
  if (entry.principalId) {
    const authorPrincipal = await db.query.principal.findFirst({
      where: eq(principal.id, entry.principalId),
      columns: { id: true, displayName: true, avatarUrl: true },
    })
    if (authorPrincipal?.displayName) {
      author = {
        id: authorPrincipal.id,
        name: authorPrincipal.displayName,
        avatarUrl: authorPrincipal.avatarUrl,
      }
    }
  }

  // Get linked posts
  const linkedPostRecords = await db.query.changelogEntryPosts.findMany({
    where: eq(changelogEntryPosts.changelogEntryId, id),
    with: {
      post: {
        columns: {
          id: true,
          title: true,
          voteCount: true,
          statusId: true,
        },
      },
    },
  })

  // Get status info for linked posts
  const linkedPosts = await Promise.all(
    linkedPostRecords.map(async (lp): Promise<ChangelogLinkedPost> => {
      let status: { name: string; color: string } | null = null
      if (lp.post.statusId) {
        const statusRow = await db.query.postStatuses.findFirst({
          where: eq(postStatuses.id, lp.post.statusId),
          columns: { name: true, color: true },
        })
        if (statusRow) {
          status = { name: statusRow.name, color: statusRow.color }
        }
      }
      return {
        id: lp.post.id,
        title: lp.post.title,
        voteCount: lp.post.voteCount,
        status,
      }
    })
  )

  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    contentJson: entry.contentJson,
    principalId: entry.principalId,
    publishedAt: entry.publishedAt,
    displayDate: entry.displayDate,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    author,
    linkedPosts,
    status: computeStatus(entry.publishedAt),
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Link posts to a changelog entry
 */
async function linkPostsToChangelog(changelogId: ChangelogId, postIds: PostId[]): Promise<void> {
  // Validate posts exist
  const existingPosts = await db.query.posts.findMany({
    where: inArray(posts.id, postIds),
    columns: { id: true },
  })

  const existingPostIds = new Set(existingPosts.map((p) => p.id))
  const validPostIds = postIds.filter((id) => existingPostIds.has(id))

  if (validPostIds.length > 0) {
    await db.insert(changelogEntryPosts).values(
      validPostIds.map((postId) => ({
        changelogEntryId: changelogId,
        postId,
      }))
    )
  }
}

/**
 * Convert publish state to publishedAt timestamp
 */
function getPublishedAtFromState(state: PublishState): Date | null {
  switch (state.type) {
    case 'draft':
      return null
    case 'scheduled':
      return state.publishAt
    case 'published':
      return state.publishAt ?? new Date()
  }
}

/**
 * Compute status from publishedAt timestamp
 */
export function computeStatus(publishedAt: Date | null): 'draft' | 'scheduled' | 'published' {
  if (!publishedAt) return 'draft'
  if (publishedAt > new Date()) return 'scheduled'
  return 'published'
}

function normalizeDisplayDate(displayDate: Date | null, publishedAt: Date | null): Date | null {
  if (displayDate == null || publishedAt == null) return displayDate
  return isSameDay(displayDate, publishedAt) ? null : displayDate
}

function validateDisplayDate(publishedAt: Date | null, displayDate: Date | null): void {
  const now = new Date()
  if (!publishedAt || publishedAt > now) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Display date can only be set on published changelog entries'
    )
  }
  if (displayDate !== null && displayDate > now) {
    throw new ValidationError('VALIDATION_ERROR', 'Display date cannot be in the future')
  }
}
