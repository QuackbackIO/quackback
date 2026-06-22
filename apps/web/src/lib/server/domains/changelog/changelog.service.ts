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
  changelogCategories,
  changelogEntries,
  changelogEntryPosts,
  changelogProducts,
  posts,
  principal,
  postStatuses,
  eq,
  and,
  isNull,
  inArray,
} from '@/lib/server/db'
import type {
  ChangelogCategoryId,
  ChangelogId,
  ChangelogProductId,
  PrincipalId,
  PostId,
} from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { slugify } from '@/lib/shared/utils'
import { markdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { rehostExternalImages } from '@/lib/server/content/rehost-images'
import {
  buildEventActor,
  dispatchChangelogPublished,
  dispatchChangelogCreated,
  dispatchChangelogUpdated,
  dispatchChangelogDeleted,
} from '@/lib/server/events/dispatch'
import type { EventActor } from '@/lib/server/events/dispatch'
import { scheduleDispatch, cancelScheduledDispatch } from '@/lib/server/events/scheduler'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'changelog' })

/**
 * Build an `EventChangelogRef` from a changelog entry with details. Lean
 * shape — ids + key display fields, mirroring the contact/organization refs.
 */
function changelogRef(entry: ChangelogEntryWithDetails) {
  return {
    id: entry.id,
    title: entry.title,
    contentPreview: entry.content.slice(0, 200),
    categoryId: entry.categoryId ?? null,
    productId: entry.productId ?? null,
    publishedAt: entry.publishedAt ? entry.publishedAt.toISOString() : null,
    linkedPostCount: entry.linkedPosts.length,
    createdAt: entry.createdAt ? entry.createdAt.toISOString() : null,
    updatedAt: entry.updatedAt ? entry.updatedAt.toISOString() : null,
  }
}
import type {
  CreateChangelogInput,
  UpdateChangelogInput,
  ChangelogEntryWithDetails,
  PublishState,
  ChangelogAuthor,
  ChangelogCategorySummary,
  ChangelogLinkedPost,
  ChangelogProductSummary,
} from './changelog.types'

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
  const categoryId = await resolveChangelogCategory(input.categoryId, input.categoryName)
  const productId = await resolveChangelogProduct(input.productId, input.productName)

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
      categoryId,
      productId,
      publishedAt,
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
  const created = await getChangelogById(entry.id)
  dispatchChangelogCreated(actor, changelogRef(created)).catch((err) =>
    log.error({ err }, 'failed to dispatch changelog created event')
  )
  return created
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
  if (input.categoryId !== undefined || input.categoryName !== undefined) {
    updateData.categoryId = await resolveChangelogCategory(input.categoryId, input.categoryName)
  }
  if (input.productId !== undefined || input.productName !== undefined) {
    updateData.productId = await resolveChangelogProduct(input.productId, input.productName)
  }
  if (input.contentJson !== undefined || input.content !== undefined) {
    const parsed = input.contentJson ?? markdownToTiptapJson((input.content ?? '').trim())
    updateData.contentJson = await rehostExternalImages(parsed, {
      contentType: 'changelog',
      principalId: existing.principalId ?? undefined,
    })
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

  const result = await getChangelogById(id)

  // Emit the generic changelog.updated event (independent of the publish-state
  // dispatch above, which fires changelog.published only on a draft→published
  // transition). Report which input fields were supplied.
  const changedFields = (
    [
      'title',
      'content',
      'contentJson',
      'categoryId',
      'categoryName',
      'productId',
      'productName',
      'publishState',
      'linkedPostIds',
    ] as const
  ).filter((k) => input[k] !== undefined)
  const updateActor: EventActor = existing.principalId
    ? buildEventActor({ principalId: existing.principalId })
    : { type: 'service', displayName: 'changelog-system' }
  dispatchChangelogUpdated(updateActor, changelogRef(result), changedFields).catch((err) =>
    log.error({ err }, 'failed to dispatch changelog updated event')
  )

  return result
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
  // Best-effort snapshot before soft-deleting so the webhook ref carries
  // display fields and we can attribute the actor to the entry's author. The
  // authoritative existence check stays the empty-result guard below, so a
  // failed snapshot read never blocks (or short-circuits) the delete.
  const existing = await getChangelogById(id).catch(() => null)

  const result = await db
    .update(changelogEntries)
    .set({ deletedAt: new Date() })
    .where(and(eq(changelogEntries.id, id), isNull(changelogEntries.deletedAt)))
    .returning()

  if (result.length === 0) {
    throw new NotFoundError('CHANGELOG_NOT_FOUND', `Changelog entry with ID ${id} not found`)
  }

  if (existing) {
    const actor: EventActor = existing.principalId
      ? buildEventActor({ principalId: existing.principalId })
      : { type: 'service', displayName: 'changelog-system' }
    dispatchChangelogDeleted(actor, changelogRef(existing)).catch((err) =>
      log.error({ err }, 'failed to dispatch changelog deleted event')
    )
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

  const [category, product] = await Promise.all([
    getChangelogCategorySummary(entry.categoryId),
    getChangelogProductSummary(entry.productId),
  ])

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
    categoryId: entry.categoryId,
    productId: entry.productId,
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    author,
    category,
    product,
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

async function resolveChangelogCategory(
  categoryId?: ChangelogCategoryId | null,
  categoryName?: string | null
): Promise<ChangelogCategoryId | null> {
  const name = categoryName?.trim()
  if (name) {
    const slug = slugify(name)
    if (!slug) {
      throw new ValidationError('VALIDATION_ERROR', 'Category name must contain letters or numbers')
    }
    const existing = await db.query.changelogCategories.findFirst({
      where: eq(changelogCategories.slug, slug),
      columns: { id: true },
    })
    if (existing) return existing.id

    const [created] = await db
      .insert(changelogCategories)
      .values({ name, slug })
      .onConflictDoNothing({ target: changelogCategories.slug })
      .returning({ id: changelogCategories.id })
    if (created) return created.id

    const afterConflict = await db.query.changelogCategories.findFirst({
      where: eq(changelogCategories.slug, slug),
      columns: { id: true },
    })
    if (afterConflict) return afterConflict.id
  }

  return categoryId ?? null
}

async function resolveChangelogProduct(
  productId?: ChangelogProductId | null,
  productName?: string | null
): Promise<ChangelogProductId | null> {
  const name = productName?.trim()
  if (name) {
    const slug = slugify(name)
    if (!slug) {
      throw new ValidationError('VALIDATION_ERROR', 'Product name must contain letters or numbers')
    }
    const existing = await db.query.changelogProducts.findFirst({
      where: eq(changelogProducts.slug, slug),
      columns: { id: true },
    })
    if (existing) return existing.id

    const [created] = await db
      .insert(changelogProducts)
      .values({ name, slug })
      .onConflictDoNothing({ target: changelogProducts.slug })
      .returning({ id: changelogProducts.id })
    if (created) return created.id

    const afterConflict = await db.query.changelogProducts.findFirst({
      where: eq(changelogProducts.slug, slug),
      columns: { id: true },
    })
    if (afterConflict) return afterConflict.id
  }

  return productId ?? null
}

async function getChangelogCategorySummary(
  categoryId: ChangelogCategoryId | null
): Promise<ChangelogCategorySummary | null> {
  if (!categoryId) return null
  const category = await db.query.changelogCategories.findFirst({
    where: eq(changelogCategories.id, categoryId),
    columns: { id: true, name: true, slug: true, color: true },
  })
  return category ?? null
}

async function getChangelogProductSummary(
  productId: ChangelogProductId | null
): Promise<ChangelogProductSummary | null> {
  if (!productId) return null
  const product = await db.query.changelogProducts.findFirst({
    where: eq(changelogProducts.id, productId),
    columns: { id: true, name: true, slug: true },
  })
  return product ?? null
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
