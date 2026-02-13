/**
 * Changelog Service - Core CRUD operations
 *
 * This service handles changelog entry operations:
 * - Create, update, delete changelog entries
 * - List and get changelog entries
 * - Link/unlink posts to changelog entries
 * - Publish, schedule, and unpublish entries
 */

import type { SQL } from 'drizzle-orm'
import {
  db,
  boards,
  changelogEntries,
  changelogEntryPosts,
  posts,
  principal,
  postStatuses,
  eq,
  and,
  isNull,
  isNotNull,
  lte,
  gt,
  desc,
  inArray,
  sql,
} from '@/lib/server/db'
import type { BoardId, ChangelogId, PrincipalId, PostId, StatusId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { buildEventActor, dispatchChangelogPublished } from '@/lib/server/events/dispatch'
import { scheduleDispatch, cancelScheduledDispatch } from '@/lib/server/events/scheduler'
import type {
  CreateChangelogInput,
  UpdateChangelogInput,
  ListChangelogParams,
  ChangelogEntryWithDetails,
  ChangelogListResult,
  PublishState,
  PublicChangelogEntry,
  PublicChangelogListResult,
  ChangelogAuthor,
  ChangelogLinkedPost,
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

  // Create the changelog entry
  const [entry] = await db
    .insert(changelogEntries)
    .values({
      title,
      content,
      contentJson: input.contentJson ?? null,
      principalId: author.principalId,
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
    }).catch((err) => console.error('[Changelog] Failed to dispatch published event:', err))
  } else if (input.publishState.type === 'scheduled' && publishedAt) {
    const delayMs = publishedAt.getTime() - Date.now()
    if (delayMs > 0) {
      scheduleDispatch({
        jobId: `changelog-publish--${entry.id}`,
        handler: '__changelog_publish__',
        delayMs,
        payload: { changelogId: entry.id, principalId: author.principalId },
        actor,
      }).catch((err) => console.error('[Changelog] Failed to schedule publish job:', err))
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
  // Get existing entry
  const existing = await db.query.changelogEntries.findFirst({
    where: eq(changelogEntries.id, id),
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
  if (input.contentJson !== undefined) updateData.contentJson = input.contentJson

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
      }).catch((err) => console.error('[Changelog] Failed to dispatch published event:', err))
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
          }).catch((err) => console.error('[Changelog] Failed to schedule publish job:', err))
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
 * Soft delete a changelog entry
 *
 * Sets deletedAt timestamp instead of removing the row.
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
  // Get the changelog entry
  const entry = await db.query.changelogEntries.findFirst({
    where: eq(changelogEntries.id, id),
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
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    author,
    linkedPosts,
    status: computeStatus(entry.publishedAt),
  }
}

/**
 * List changelog entries with filtering and pagination
 *
 * @param params - List parameters
 * @returns Paginated list of changelog entries
 */
export async function listChangelogs(params: ListChangelogParams): Promise<ChangelogListResult> {
  const { status = 'all', cursor, limit = 20 } = params
  const now = new Date()

  // Build where conditions - always exclude soft-deleted entries
  const conditions: SQL<unknown>[] = [isNull(changelogEntries.deletedAt)]

  // Filter by status
  if (status === 'draft') {
    conditions.push(isNull(changelogEntries.publishedAt))
  } else if (status === 'scheduled') {
    conditions.push(isNotNull(changelogEntries.publishedAt))
    conditions.push(gt(changelogEntries.publishedAt, now))
  } else if (status === 'published') {
    conditions.push(isNotNull(changelogEntries.publishedAt))
    conditions.push(lte(changelogEntries.publishedAt, now))
  }

  // Cursor-based pagination (cursor is the last entry ID)
  if (cursor) {
    const cursorEntry = await db.query.changelogEntries.findFirst({
      where: eq(changelogEntries.id, cursor as ChangelogId),
      columns: { createdAt: true },
    })
    if (cursorEntry) {
      conditions.push(lte(changelogEntries.createdAt, cursorEntry.createdAt))
    }
  }

  // Fetch entries
  const entries = await db.query.changelogEntries.findMany({
    where: and(...conditions),
    orderBy: [desc(changelogEntries.createdAt)],
    limit: limit + 1, // Fetch one extra to check hasMore
  })

  const hasMore = entries.length > limit
  const items = hasMore ? entries.slice(0, limit) : entries

  // Get principal IDs for author lookup
  const principalIds = items
    .map((e) => e.principalId)
    .filter((id): id is PrincipalId => id !== null)
  const authorMap = new Map<PrincipalId, ChangelogAuthor>()

  if (principalIds.length > 0) {
    const principals = await db.query.principal.findMany({
      where: inArray(principal.id, principalIds),
      columns: { id: true, displayName: true, avatarUrl: true },
    })
    for (const p of principals) {
      if (p.displayName) {
        authorMap.set(p.id, {
          id: p.id,
          name: p.displayName,
          avatarUrl: p.avatarUrl,
        })
      }
    }
  }

  // Get linked posts for all entries
  const entryIds = items.map((e) => e.id)
  const allLinkedPosts =
    entryIds.length > 0
      ? await db.query.changelogEntryPosts.findMany({
          where: inArray(changelogEntryPosts.changelogEntryId, entryIds),
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
      : []

  // Group linked posts by changelog entry
  const linkedPostsMap = new Map<ChangelogId, typeof allLinkedPosts>()
  for (const lp of allLinkedPosts) {
    const existing = linkedPostsMap.get(lp.changelogEntryId) ?? []
    existing.push(lp)
    linkedPostsMap.set(lp.changelogEntryId, existing)
  }

  // Get status info for all linked posts
  const statusIds = new Set<StatusId>()
  allLinkedPosts.forEach((lp) => {
    if (lp.post.statusId) statusIds.add(lp.post.statusId)
  })

  const statusMap = new Map<StatusId, { name: string; color: string }>()
  if (statusIds.size > 0) {
    const statuses = await db.query.postStatuses.findMany({
      where: inArray(postStatuses.id, Array.from(statusIds) as StatusId[]),
      columns: { id: true, name: true, color: true },
    })
    statuses.forEach((s) => statusMap.set(s.id, { name: s.name, color: s.color }))
  }

  // Transform to output format
  const result: ChangelogEntryWithDetails[] = items.map((entry) => {
    const entryLinkedPosts = linkedPostsMap.get(entry.id) ?? []
    return {
      id: entry.id,
      title: entry.title,
      content: entry.content,
      contentJson: entry.contentJson,
      principalId: entry.principalId,
      publishedAt: entry.publishedAt,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      author: entry.principalId ? (authorMap.get(entry.principalId) ?? null) : null,
      linkedPosts: entryLinkedPosts.map((lp) => ({
        id: lp.post.id,
        title: lp.post.title,
        voteCount: lp.post.voteCount,
        status: lp.post.statusId ? (statusMap.get(lp.post.statusId) ?? null) : null,
      })),
      status: computeStatus(entry.publishedAt),
    }
  })

  return {
    items: result,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
  }
}

// ============================================================================
// Public (Portal) Read Operations
// ============================================================================

/**
 * Get a published changelog entry by ID for public view
 *
 * @param id - Changelog entry ID
 * @returns Public changelog entry
 */
export async function getPublicChangelogById(id: ChangelogId): Promise<PublicChangelogEntry> {
  const now = new Date()

  const entry = await db.query.changelogEntries.findFirst({
    where: and(
      eq(changelogEntries.id, id),
      isNotNull(changelogEntries.publishedAt),
      lte(changelogEntries.publishedAt, now)
    ),
  })

  if (!entry || !entry.publishedAt) {
    throw new NotFoundError(
      'CHANGELOG_NOT_FOUND',
      `Published changelog entry with ID ${id} not found`
    )
  }

  // Get linked posts with board slugs and status
  const linkedPostRecords = await db.query.changelogEntryPosts.findMany({
    where: eq(changelogEntryPosts.changelogEntryId, id),
    with: {
      post: {
        columns: {
          id: true,
          title: true,
          voteCount: true,
          boardId: true,
          statusId: true,
        },
        with: {
          board: {
            columns: {
              slug: true,
            },
          },
        },
      },
    },
  })

  // Get status info for linked posts
  const statusIds = new Set<StatusId>()
  linkedPostRecords.forEach((lp) => {
    if (lp.post.statusId) statusIds.add(lp.post.statusId)
  })

  const statusMap = new Map<StatusId, { name: string; color: string }>()
  if (statusIds.size > 0) {
    const statuses = await db.query.postStatuses.findMany({
      where: inArray(postStatuses.id, Array.from(statusIds) as StatusId[]),
      columns: { id: true, name: true, color: true },
    })
    statuses.forEach((s) => statusMap.set(s.id, { name: s.name, color: s.color }))
  }

  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    contentJson: entry.contentJson,
    publishedAt: entry.publishedAt,
    linkedPosts: linkedPostRecords.map((lp) => ({
      id: lp.post.id,
      title: lp.post.title,
      voteCount: lp.post.voteCount,
      boardSlug: lp.post.board?.slug ?? '',
      status: lp.post.statusId ? (statusMap.get(lp.post.statusId) ?? null) : null,
    })),
  }
}

/**
 * List published changelog entries for public view
 *
 * @param params - List parameters
 * @returns Paginated list of public changelog entries
 */
export async function listPublicChangelogs(params: {
  cursor?: string
  limit?: number
}): Promise<PublicChangelogListResult> {
  const { cursor, limit = 20 } = params
  const now = new Date()

  // Build where conditions - only published entries
  const conditions = [
    isNotNull(changelogEntries.publishedAt),
    lte(changelogEntries.publishedAt, now),
  ]

  // Cursor-based pagination
  if (cursor) {
    const cursorEntry = await db.query.changelogEntries.findFirst({
      where: eq(changelogEntries.id, cursor as ChangelogId),
      columns: { publishedAt: true },
    })
    if (cursorEntry?.publishedAt) {
      conditions.push(lte(changelogEntries.publishedAt, cursorEntry.publishedAt))
    }
  }

  // Fetch entries
  const entries = await db.query.changelogEntries.findMany({
    where: and(...conditions),
    orderBy: [desc(changelogEntries.publishedAt)],
    limit: limit + 1,
  })

  const hasMore = entries.length > limit
  const items = hasMore ? entries.slice(0, limit) : entries

  // Get linked posts for all entries
  const entryIds = items.map((e) => e.id)
  const allLinkedPosts =
    entryIds.length > 0
      ? await db.query.changelogEntryPosts.findMany({
          where: inArray(changelogEntryPosts.changelogEntryId, entryIds),
          with: {
            post: {
              columns: {
                id: true,
                title: true,
                voteCount: true,
                boardId: true,
                statusId: true,
              },
              with: {
                board: {
                  columns: {
                    slug: true,
                  },
                },
              },
            },
          },
        })
      : []

  // Group linked posts by changelog entry
  const linkedPostsMap = new Map<ChangelogId, typeof allLinkedPosts>()
  for (const lp of allLinkedPosts) {
    const existing = linkedPostsMap.get(lp.changelogEntryId) ?? []
    existing.push(lp)
    linkedPostsMap.set(lp.changelogEntryId, existing)
  }

  // Get status info for all linked posts
  const publicStatusIds = new Set<StatusId>()
  allLinkedPosts.forEach((lp) => {
    if (lp.post.statusId) publicStatusIds.add(lp.post.statusId)
  })

  const publicStatusMap = new Map<StatusId, { name: string; color: string }>()
  if (publicStatusIds.size > 0) {
    const statuses = await db.query.postStatuses.findMany({
      where: inArray(postStatuses.id, Array.from(publicStatusIds) as StatusId[]),
      columns: { id: true, name: true, color: true },
    })
    statuses.forEach((s) => publicStatusMap.set(s.id, { name: s.name, color: s.color }))
  }

  // Transform to output format (no author info for public view)
  const result: PublicChangelogEntry[] = items
    .filter((entry) => entry.publishedAt !== null)
    .map((entry) => {
      const entryLinkedPosts = linkedPostsMap.get(entry.id) ?? []
      return {
        id: entry.id,
        title: entry.title,
        content: entry.content,
        contentJson: entry.contentJson,
        publishedAt: entry.publishedAt!,
        linkedPosts: entryLinkedPosts.map((lp) => ({
          id: lp.post.id,
          title: lp.post.title,
          voteCount: lp.post.voteCount,
          boardSlug: lp.post.board?.slug ?? '',
          status: lp.post.statusId ? (publicStatusMap.get(lp.post.statusId) ?? null) : null,
        })),
      }
    })

  return {
    items: result,
    nextCursor: hasMore && items.length > 0 ? items[items.length - 1].id : null,
    hasMore,
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
      return new Date()
  }
}

/**
 * Compute status from publishedAt timestamp
 */
function computeStatus(publishedAt: Date | null): 'draft' | 'scheduled' | 'published' {
  if (!publishedAt) return 'draft'
  if (publishedAt > new Date()) return 'scheduled'
  return 'published'
}

// ============================================================================
// Shipped Posts Search
// ============================================================================

/**
 * Search posts with status category 'complete' for linking to changelogs
 *
 * @param params - Search parameters
 * @returns List of shipped posts matching the search query
 */
export async function searchShippedPosts(params: {
  query?: string
  boardId?: BoardId
  limit?: number
}): Promise<
  Array<{
    id: PostId
    title: string
    voteCount: number
    boardSlug: string
    authorName: string | null
    createdAt: Date
  }>
> {
  const { query, boardId, limit = 20 } = params

  // Get all status IDs with category 'complete'
  const completeStatuses = await db.query.postStatuses.findMany({
    where: eq(postStatuses.category, 'complete'),
    columns: { id: true },
  })

  if (completeStatuses.length === 0) {
    return []
  }

  const statusIds = completeStatuses.map((s) => s.id)

  // Build conditions
  const conditions = [inArray(posts.statusId, statusIds), isNull(posts.deletedAt)]

  if (boardId) {
    conditions.push(eq(posts.boardId, boardId))
  }

  // Search by title if query provided
  if (query?.trim()) {
    const searchTerm = `%${query.trim().toLowerCase()}%`
    conditions.push(sql`LOWER(${posts.title}) LIKE ${searchTerm}`)
  }

  // Fetch posts with board slug and author info
  const results = await db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      boardSlug: boards.slug,
      authorName: sql<string | null>`(
        SELECT m.display_name FROM ${principal} m
        WHERE m.id = ${posts.principalId}
      )`.as('author_name'),
      createdAt: posts.createdAt,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(and(...conditions))
    .orderBy(desc(posts.voteCount), desc(posts.createdAt))
    .limit(limit)

  return results
}
