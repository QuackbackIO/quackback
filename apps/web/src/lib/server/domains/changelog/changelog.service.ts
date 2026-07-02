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
  asc,
  isNull,
  isNotNull,
  lte,
  inArray,
} from '@/lib/server/db'
import type { ChangelogId, PrincipalId, PostId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { markdownToTiptapJson, contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
import {
  buildEventActor,
  dispatchChangelogPublished,
  type EventActor,
} from '@/lib/server/events/dispatch'
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
      // Store the markdown projection of the canonical contentJson so every
      // consumer of the `content` column (webhooks, notifications) sees images.
      content: contentJsonToMarkdown(contentJson, content),
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
    notifyChangelogPublished(entry.id, actor).catch((err) =>
      log.error({ err }, 'failed to dispatch changelog published event')
    )
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
  if (input.contentJson !== undefined || input.content !== undefined) {
    const parsed = input.contentJson ?? markdownToTiptapJson((input.content ?? '').trim())
    const contentJson = await rehostExternalImages(parsed, {
      contentType: 'changelog',
      principalId: existing.principalId ?? undefined,
    })
    updateData.contentJson = contentJson
    // Every content edit carries `input.content` (the API accepts only markdown;
    // the editor emits markdown alongside contentJson), so the fallback reflects
    // the new doc. `existing.content` is only a defensive default for a
    // contentJson-only edit, which no caller makes.
    updateData.content = contentJsonToMarkdown(
      contentJson,
      (input.content ?? existing.content).trim()
    )
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
      // Cancel any pending scheduled job, then announce. The helper's atomic
      // claim makes this a no-op if the entry was already announced.
      cancelScheduledDispatch(jobId).catch(() => {})
      notifyChangelogPublished(id, actor).catch((err) =>
        log.error({ err }, 'failed to dispatch changelog published event')
      )
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
// Publish notification
// ============================================================================

/**
 * Predicates for an entry that is publicly live (published, due, not deleted)
 * but not yet announced. Shared by the atomic claim and the reconciler so the
 * two can't drift. Mirrors `publicChangelogConditions` in changelog.public.ts
 * (kept separate to avoid an import cycle) plus the not-yet-notified guard, so
 * an entry is announced exactly when it becomes publicly visible.
 */
function liveUnnotifiedConditions(now: Date) {
  return [
    isNull(changelogEntries.notifiedAt),
    isNotNull(changelogEntries.publishedAt),
    lte(changelogEntries.publishedAt, now),
    isNull(changelogEntries.deletedAt),
  ]
}

/**
 * Announce a published changelog entry exactly once.
 *
 * Atomically claims the entry by flipping `notifiedAt` from null, and only
 * for an entry that is actually live (published, not future-dated, not
 * soft-deleted). Only the caller whose UPDATE matched a row dispatches, so
 * concurrent publish paths and the reconciler never double-notify. If the
 * dispatch fails the claim is released so the reconciler retries later.
 *
 * Returns true when this call sent the announcement, false otherwise.
 */
export async function notifyChangelogPublished(
  id: ChangelogId,
  actor: EventActor
): Promise<boolean> {
  const now = new Date()
  const [claimed] = await db
    .update(changelogEntries)
    .set({ notifiedAt: now })
    .where(and(eq(changelogEntries.id, id), ...liveUnnotifiedConditions(now)))
    .returning()

  if (!claimed) return false

  try {
    const linkedPosts = await db.query.changelogEntryPosts.findMany({
      where: eq(changelogEntryPosts.changelogEntryId, id),
      columns: { postId: true },
    })
    // rethrow so an enqueue failure reaches the catch below; dispatch is
    // otherwise best-effort and would swallow it.
    await dispatchChangelogPublished(
      actor,
      {
        id: claimed.id,
        title: claimed.title,
        contentPreview: claimed.content.slice(0, 200),
        publishedAt: claimed.publishedAt!,
        linkedPostCount: linkedPosts.length,
      },
      { rethrow: true }
    )
    return true
  } catch (err) {
    // Release the claim so the reconciler retries; nothing went out.
    await db
      .update(changelogEntries)
      .set({ notifiedAt: null })
      .where(eq(changelogEntries.id, id))
      .catch(() => {})
    log.error({ err, changelog_id: id }, 'failed to dispatch changelog published event')
    return false
  }
}

/**
 * Safety net for publish notifications. Finds entries that are live but were
 * never announced (a dropped delayed-publish job, or a dispatch that failed
 * after the synchronous publish) and notifies each via {@link
 * notifyChangelogPublished}. Idempotent via that helper's atomic claim;
 * intended to run on an interval under a cross-instance sweep lock.
 *
 * @returns the number of entries announced this pass.
 */
export async function reconcileChangelogNotifications(): Promise<number> {
  const due = await db
    .select({ id: changelogEntries.id, principalId: changelogEntries.principalId })
    .from(changelogEntries)
    .where(and(...liveUnnotifiedConditions(new Date())))
    .orderBy(asc(changelogEntries.publishedAt))
    .limit(100)

  let notified = 0
  for (const entry of due) {
    const actor = entry.principalId
      ? buildEventActor({ principalId: entry.principalId })
      : { type: 'service' as const, displayName: 'scheduler' }
    if (await notifyChangelogPublished(entry.id, actor)) notified++
  }
  return notified
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
