import {
  db,
  changelogEntries,
  changelogEntryPosts,
  postStatuses,
  eq,
  and,
  isNotNull,
  lt,
  lte,
  or,
  desc,
  inArray,
} from '@/lib/server/db'
import type { ChangelogId, StatusId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { computeStatus } from './changelog.service'
import type { PublicChangelogEntry, PublicChangelogListResult } from './changelog.types'

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
  const allLinkedPostRecords = await db.query.changelogEntryPosts.findMany({
    where: eq(changelogEntryPosts.changelogEntryId, id),
    with: {
      post: {
        columns: {
          id: true,
          title: true,
          voteCount: true,
          boardId: true,
          statusId: true,
          deletedAt: true,
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

  // Exclude deleted posts from public changelog
  const linkedPostRecords = allLinkedPostRecords.filter((lp) => !lp.post.deletedAt)

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
      conditions.push(
        or(
          lt(changelogEntries.publishedAt, cursorEntry.publishedAt),
          and(
            eq(changelogEntries.publishedAt, cursorEntry.publishedAt),
            lt(changelogEntries.id, cursor as ChangelogId)
          )
        )!
      )
    }
  }

  // Fetch entries
  const entries = await db.query.changelogEntries.findMany({
    where: and(...conditions),
    orderBy: [desc(changelogEntries.publishedAt), desc(changelogEntries.id)],
    limit: limit + 1,
  })

  const hasMore = entries.length > limit
  const items = hasMore ? entries.slice(0, limit) : entries

  // Get linked posts for all entries
  const entryIds = items.map((e) => e.id)
  const allLinkedPosts = (
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
                deletedAt: true,
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
  ).filter((lp) => !lp.post.deletedAt)

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

// Re-export computeStatus for convenience (used by changelog.query.ts too)
export { computeStatus }
