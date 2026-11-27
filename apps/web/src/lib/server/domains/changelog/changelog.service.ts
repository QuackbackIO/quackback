/* oxlint-disable max-lines -- notifyChangelogPublished builds the full email
   body payload alongside the existing claim/release writes */
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
  type Transaction,
} from '@/lib/server/db'
import type { ChangelogId, PrincipalId, PostId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { markdownToTiptapJson, projectContentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
import { contentJsonForClient } from '@/lib/server/content/storage-read-urls'
import { resignStoredAssetUrl } from '@/lib/server/storage/s3'
import { changelogBodyHtml } from './changelog-email-body'
import {
  buildEventActor,
  dispatchChangelogPublished,
  type EventActor,
} from '@/lib/server/events/dispatch'
import { scheduleDispatch, cancelScheduledDispatch } from '@/lib/server/events/scheduler'
import { setEntryCategories, getCategoriesForEntries } from './changelog-category.service'
import { embedChangelogEntryOnPublish } from './changelog-embedding.service'
import { logger } from '@/lib/server/logger'

import { isSameDay } from 'date-fns'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
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
  const markdown = input.content?.trim() ?? ''
  const sourceJson = input.contentJson ?? null
  const jsonHasContent = sourceJson != null && !isEmptyTiptapDoc(sourceJson)

  if (!title) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  // The admin editor stores markdown from TipTap's serializer. That string can
  // be empty while contentJson still has a body (list-only docs, serializer
  // skips/throws on custom nodes). Reject only when both projections are empty.
  if (!markdown && !jsonHasContent) {
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
  const parsedContentJson = jsonHasContent ? sourceJson : markdownToTiptapJson(markdown)
  const contentJson = await rehostExternalImages(parsedContentJson, {
    contentType: 'changelog',
    principalId: author.principalId,
  })

  // The entry, its links and its labels are written together: a failed link
  // write leaves no half-made entry behind.
  const entry = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(changelogEntries)
      .values({
        title,
        // Store the markdown projection of the canonical contentJson so every
        // consumer of the `content` column (webhooks, notifications) sees images.
        content: projectContentJsonToMarkdown(contentJson, markdown),
        contentJson,
        principalId: author.principalId,
        publishedAt,
        ...(displayDate != null && { displayDate }),
        ...(input.featuredImageUrl != null && { featuredImageUrl: input.featuredImageUrl }),
        ...(input.segmentIds != null && { segmentIds: input.segmentIds }),
        ...(input.announceOnLauncher != null && { announceOnLauncher: input.announceOnLauncher }),
      })
      .returning()

    if (input.linkedPostIds && input.linkedPostIds.length > 0) {
      await linkPostsToChangelog(tx, created.id, input.linkedPostIds)
    }
    if (input.categoryIds && input.categoryIds.length > 0) {
      await setEntryCategories(created.id, input.categoryIds, tx)
    }
    return created
  })

  // Dispatch event or schedule delayed job based on publish state. `notify`
  // defaults true; false stamps notifiedAt without dispatching (see
  // notifyChangelogPublished).
  const notify = input.notify ?? true
  const actor = buildEventActor({ principalId: author.principalId })
  if (input.publishState.type === 'published') {
    notifyChangelogPublished(entry.id, actor, notify).catch((err) =>
      log.error({ err }, 'failed to dispatch changelog published event')
    )
  } else if (input.publishState.type === 'scheduled' && publishedAt) {
    const delayMs = publishedAt.getTime() - Date.now()
    if (delayMs > 0) {
      scheduleDispatch({
        jobId: `changelog-publish--${entry.id}`,
        handler: '__changelog_publish__',
        delayMs,
        payload: { changelogId: entry.id, principalId: author.principalId, notify },
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
  input: UpdateChangelogInput,
  publisher?: { principalId: PrincipalId }
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
  // Same rule as create: a body is required, and only refused when both the
  // markdown and the document are empty.
  const bodySent = input.contentJson !== undefined || input.content !== undefined
  const markdown = (input.content ?? '').trim()
  const jsonHasContent = input.contentJson != null && !isEmptyTiptapDoc(input.contentJson)
  if (bodySent && !markdown && !jsonHasContent) {
    throw new ValidationError('VALIDATION_ERROR', 'Content is required')
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  }

  if (input.title !== undefined) updateData.title = input.title.trim()
  if (bodySent) {
    const parsed = jsonHasContent ? input.contentJson! : markdownToTiptapJson(markdown)
    const contentJson = await rehostExternalImages(parsed, {
      contentType: 'changelog',
      principalId: existing.principalId ?? undefined,
    })
    updateData.contentJson = contentJson
    updateData.content = projectContentJsonToMarkdown(
      contentJson,
      (input.content ?? existing.content).trim()
    )
  }

  if (input.displayDate !== undefined) {
    const publishedAtRef =
      input.publishState !== undefined
        ? getPublishedAtFromState(input.publishState)
        : existing.publishedAt
    // Clearing the override (null) is always allowed, so a stale display date
    // on a draft or scheduled entry can be removed.
    if (input.displayDate !== null) validateDisplayDate(publishedAtRef, input.displayDate)
    updateData.displayDate = normalizeDisplayDate(input.displayDate, publishedAtRef)
  }

  // Handle publish state change
  if (input.publishState !== undefined) {
    updateData.publishedAt = getPublishedAtFromState(input.publishState)
  }

  // featuredImageUrl: undefined leaves it, null clears it, a string replaces it.
  if (input.featuredImageUrl !== undefined) {
    updateData.featuredImageUrl = input.featuredImageUrl
  }

  // segmentIds: undefined leaves the targeting untouched; a provided list
  // (including []) replaces it wholesale.
  if (input.segmentIds !== undefined) {
    updateData.segmentIds = input.segmentIds
  }

  // announceOnLauncher: undefined leaves the choice untouched.
  if (input.announceOnLauncher !== undefined) {
    updateData.announceOnLauncher = input.announceOnLauncher
  }

  // The entry, its links and its labels change together: replacing the links
  // never leaves an entry with its old links deleted and the new ones unsaved.
  await db.transaction(async (tx) => {
    await tx.update(changelogEntries).set(updateData).where(eq(changelogEntries.id, id))

    // Linked posts and labels are replaced in full when provided.
    if (input.linkedPostIds !== undefined) {
      await tx.delete(changelogEntryPosts).where(eq(changelogEntryPosts.changelogEntryId, id))
      if (input.linkedPostIds.length > 0) {
        await linkPostsToChangelog(tx, id, input.linkedPostIds)
      }
    }
    if (input.categoryIds !== undefined) {
      await setEntryCategories(id, input.categoryIds, tx)
    }
  })

  // Handle event dispatch / scheduling when publish state changes
  if (input.publishState !== undefined) {
    const jobId = `changelog-publish--${id}`
    // The person publishing now, when known, so they are not told about their
    // own announcement; otherwise the entry's author.
    const actorPrincipalId = publisher?.principalId ?? existing.principalId
    const actor = actorPrincipalId
      ? buildEventActor({ principalId: actorPrincipalId })
      : { type: 'service' as const, displayName: 'system' }
    const notify = input.notify ?? true

    if (input.publishState.type === 'published') {
      // Cancel any pending scheduled job, then announce. The helper's atomic
      // claim makes this a no-op if the entry was already announced.
      cancelScheduledDispatch(jobId).catch(() => {})
      notifyChangelogPublished(id, actor, notify).catch((err) =>
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
            payload: { changelogId: id, principalId: actorPrincipalId, notify },
            actor,
          }).catch((err) => log.error({ err }, 'failed to schedule changelog publish job'))
        }
      }
    } else if (input.publishState.type === 'draft') {
      cancelScheduledDispatch(jobId).catch(() => {})
    }
  }

  // Re-embed on a content/title edit (Quinn Phase 4). The publish-transition
  // paths above already re-embed via `notifyChangelogPublished`; this covers an
  // edit to an ALREADY-published entry whose `publishState` didn't change (that
  // helper isn't called then). The embed service no-ops for drafts/scheduled
  // entries, so an unpublished edit stays unembedded. Fire-and-forget.
  const contentChanged =
    input.contentJson !== undefined || input.content !== undefined || input.title !== undefined
  if (contentChanged && input.publishState === undefined) {
    void embedChangelogEntryOnPublish(id)
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

  // Categories (labels) attached to this entry.
  const categoriesMap = await getCategoriesForEntries([id])
  const categories = (categoriesMap.get(id) ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
  }))

  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    contentJson: contentJsonForClient(entry.contentJson),
    principalId: entry.principalId,
    publishedAt: entry.publishedAt,
    displayDate: entry.displayDate,
    featuredImageUrl: entry.featuredImageUrl
      ? resignStoredAssetUrl(entry.featuredImageUrl)
      : entry.featuredImageUrl,
    segmentIds: (entry.segmentIds ?? []) as ChangelogEntryWithDetails['segmentIds'],
    announceOnLauncher: entry.announceOnLauncher,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    viewCount: entry.viewCount,
    author,
    linkedPosts,
    categories,
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
 * `notify=false` (the publish-time "Send email to subscribers" checkbox,
 * unchecked) still performs the atomic claim — so the entry is marked
 * announced and the reconciler leaves it alone forever — but skips the
 * actual dispatch. This preserves the idempotence invariant: an entry is
 * claimed at most once, dispatched or not.
 *
 * Returns true when this call claimed the entry (dispatched or silently
 * claimed), false when another caller had already claimed it.
 */
export async function notifyChangelogPublished(
  id: ChangelogId,
  actor: EventActor,
  notify: boolean = true
): Promise<boolean> {
  const now = new Date()
  const [claimed] = await db
    .update(changelogEntries)
    .set({ notifiedAt: now })
    .where(and(eq(changelogEntries.id, id), ...liveUnnotifiedConditions(now)))
    .returning()

  if (!claimed) return false

  // Embed the just-published entry for Quinn grounding (Quinn Phase 4).
  // Fire-and-forget + best-effort (the service swallows its own errors), off
  // the exact publish moment: this helper is the single funnel every publish
  // path (create, update-to-published, scheduled job, reconciler) reaches, so
  // one call here covers them all. Independent of `notify` — the entry is now
  // public knowledge whether or not subscribers were emailed.
  void embedChangelogEntryOnPublish(id)

  if (!notify) return true

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
        contentHtml: changelogBodyHtml(claimed.content, claimed.contentJson),
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
async function linkPostsToChangelog(
  tx: Transaction,
  changelogId: ChangelogId,
  postIds: PostId[]
): Promise<void> {
  // Validate posts exist
  const existingPosts = await tx.query.posts.findMany({
    where: inArray(posts.id, postIds),
    columns: { id: true },
  })

  const existingPostIds = new Set(existingPosts.map((p) => p.id))
  // A post listed twice is linked once.
  const validPostIds = [...new Set(postIds)].filter((id) => existingPostIds.has(id))

  if (validPostIds.length > 0) {
    await tx.insert(changelogEntryPosts).values(
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
