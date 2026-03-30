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
  lt,
  lte,
  gt,
  or,
  desc,
  inArray,
  sql,
} from '@/lib/server/db'
import type { BoardId, ChangelogId, PrincipalId, PostId, StatusId } from '@quackback/ids'
import { computeStatus } from './changelog.service'
import type {
  ListChangelogParams,
  ChangelogEntryWithDetails,
  ChangelogListResult,
  ChangelogAuthor,
} from './changelog.types'

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
      conditions.push(
        or(
          lt(changelogEntries.createdAt, cursorEntry.createdAt),
          and(
            eq(changelogEntries.createdAt, cursorEntry.createdAt),
            lt(changelogEntries.id, cursor as ChangelogId)
          )
        )!
      )
    }
  }

  // Fetch entries
  const entries = await db.query.changelogEntries.findMany({
    where: and(...conditions),
    orderBy: [desc(changelogEntries.createdAt), desc(changelogEntries.id)],
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
