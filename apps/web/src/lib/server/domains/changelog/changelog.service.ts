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
  boards,
  changelogEntries,
  changelogEntryPosts,
  posts,
  member,
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
import type { BoardId, ChangelogId, MemberId, PostId, StatusId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
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
  author: { memberId: MemberId; name: string }
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

  // Validate board exists
  const board = await db.query.boards.findFirst({ where: eq(boards.id, input.boardId) })
  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${input.boardId} not found`)
  }

  // Determine publishedAt based on publish state
  const publishedAt = getPublishedAtFromState(input.publishState)

  // Create the changelog entry
  const [entry] = await db
    .insert(changelogEntries)
    .values({
      boardId: input.boardId,
      title,
      content,
      contentJson: input.contentJson ?? null,
      memberId: author.memberId,
      publishedAt,
    })
    .returning()

  // Link posts if provided
  if (input.linkedPostIds && input.linkedPostIds.length > 0) {
    await linkPostsToChangelog(entry.id, input.linkedPostIds)
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

  return getChangelogById(id)
}

// ============================================================================
// Delete
// ============================================================================

/**
 * Delete a changelog entry
 *
 * @param id - Changelog entry ID
 */
export async function deleteChangelog(id: ChangelogId): Promise<void> {
  const result = await db.delete(changelogEntries).where(eq(changelogEntries.id, id)).returning()

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

  // Get author info (member -> user for name/avatar)
  let author: ChangelogAuthor | null = null
  if (entry.memberId) {
    const memberWithUser = await db.query.member.findFirst({
      where: eq(member.id, entry.memberId),
      with: {
        user: {
          columns: {
            name: true,
            image: true,
          },
        },
      },
    })
    if (memberWithUser?.user) {
      author = {
        id: memberWithUser.id,
        name: memberWithUser.user.name,
        avatarUrl: memberWithUser.user.image,
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
    boardId: entry.boardId,
    title: entry.title,
    content: entry.content,
    contentJson: entry.contentJson,
    memberId: entry.memberId,
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
  const { boardId, status = 'all', cursor, limit = 20 } = params
  const now = new Date()

  // Build where conditions
  const conditions = []

  if (boardId) {
    conditions.push(eq(changelogEntries.boardId, boardId))
  }

  // Filter by status
  if (status === 'draft') {
    conditions.push(isNull(changelogEntries.publishedAt))
  } else if (status === 'scheduled') {
    conditions.push(
      and(isNotNull(changelogEntries.publishedAt), gt(changelogEntries.publishedAt, now))
    )
  } else if (status === 'published') {
    conditions.push(
      and(isNotNull(changelogEntries.publishedAt), lte(changelogEntries.publishedAt, now))
    )
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
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(changelogEntries.createdAt)],
    limit: limit + 1, // Fetch one extra to check hasMore
  })

  const hasMore = entries.length > limit
  const items = hasMore ? entries.slice(0, limit) : entries

  // Get member IDs for author lookup
  const memberIds = items.map((e) => e.memberId).filter((id): id is MemberId => id !== null)
  const authorMap = new Map<MemberId, ChangelogAuthor>()

  if (memberIds.length > 0) {
    const membersWithUsers = await db.query.member.findMany({
      where: inArray(member.id, memberIds),
      with: {
        user: {
          columns: {
            name: true,
            image: true,
          },
        },
      },
    })
    for (const m of membersWithUsers) {
      if (m.user) {
        authorMap.set(m.id, {
          id: m.id,
          name: m.user.name,
          avatarUrl: m.user.image,
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
      boardId: entry.boardId,
      title: entry.title,
      content: entry.content,
      contentJson: entry.contentJson,
      memberId: entry.memberId,
      publishedAt: entry.publishedAt,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      author: entry.memberId ? (authorMap.get(entry.memberId) ?? null) : null,
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

  // Get author info
  let author: ChangelogAuthor | null = null
  if (entry.memberId) {
    const memberWithUser = await db.query.member.findFirst({
      where: eq(member.id, entry.memberId),
      with: {
        user: {
          columns: {
            name: true,
            image: true,
          },
        },
      },
    })
    if (memberWithUser?.user) {
      author = {
        id: memberWithUser.id,
        name: memberWithUser.user.name,
        avatarUrl: memberWithUser.user.image,
      }
    }
  }

  // Get linked posts with board slugs
  const linkedPostRecords = await db.query.changelogEntryPosts.findMany({
    where: eq(changelogEntryPosts.changelogEntryId, id),
    with: {
      post: {
        columns: {
          id: true,
          title: true,
          voteCount: true,
          boardId: true,
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

  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    contentJson: entry.contentJson,
    publishedAt: entry.publishedAt,
    author,
    linkedPosts: linkedPostRecords.map((lp) => ({
      id: lp.post.id,
      title: lp.post.title,
      voteCount: lp.post.voteCount,
      boardSlug: lp.post.board?.slug ?? '',
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
  boardId?: BoardId
  cursor?: string
  limit?: number
}): Promise<PublicChangelogListResult> {
  const { boardId, cursor, limit = 20 } = params
  const now = new Date()

  // Build where conditions - only published entries
  const conditions = [
    isNotNull(changelogEntries.publishedAt),
    lte(changelogEntries.publishedAt, now),
  ]

  if (boardId) {
    conditions.push(eq(changelogEntries.boardId, boardId))
  }

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

  // Get member IDs for author lookup
  const memberIds = items.map((e) => e.memberId).filter((id): id is MemberId => id !== null)
  const authorMap = new Map<MemberId, ChangelogAuthor>()

  if (memberIds.length > 0) {
    const membersWithUsers = await db.query.member.findMany({
      where: inArray(member.id, memberIds),
      with: {
        user: {
          columns: {
            name: true,
            image: true,
          },
        },
      },
    })
    for (const m of membersWithUsers) {
      if (m.user) {
        authorMap.set(m.id, {
          id: m.id,
          name: m.user.name,
          avatarUrl: m.user.image,
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
                boardId: true,
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

  // Transform to output format
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
        author: entry.memberId ? (authorMap.get(entry.memberId) ?? null) : null,
        linkedPosts: entryLinkedPosts.map((lp) => ({
          id: lp.post.id,
          title: lp.post.title,
          voteCount: lp.post.voteCount,
          boardSlug: lp.post.board?.slug ?? '',
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
}): Promise<Array<{ id: PostId; title: string; voteCount: number; boardSlug: string }>> {
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

  // Fetch posts with board slug
  const results = await db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      boardSlug: boards.slug,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(and(...conditions))
    .orderBy(desc(posts.voteCount), desc(posts.createdAt))
    .limit(limit)

  return results
}
