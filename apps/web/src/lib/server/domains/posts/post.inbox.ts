/**
 * Post Inbox Query
 *
 * Handles the admin inbox listing with advanced filtering and cursor-based pagination.
 */

import {
  db,
  posts,
  postStatuses,
  postTags,
  userSegments,
  eq,
  and,
  inArray,
  desc,
  asc,
  sql,
  isNull,
  isNotNull,
} from '@/lib/server/db'
import { toUuid, type PostId, type PrincipalId } from '@quackback/ids'
import type { PostListItem, InboxPostListParams, InboxPostListResult } from './post.types'

/**
 * List posts for admin inbox with advanced filtering
 *
 * @param params - Query parameters including filters, sort, and pagination
 * @returns Result containing inbox post list or an error
 */
export async function listInboxPosts(params: InboxPostListParams): Promise<InboxPostListResult> {
  const {
    boardIds,
    statusIds,
    statusSlugs,
    tagIds,
    segmentIds,
    ownerId,
    search,
    dateFrom,
    dateTo,
    minVotes,
    minComments,
    responded,
    updatedBefore,
    showDeleted,
    sort = 'newest',
    cursor,
    limit = 20,
  } = params

  // Build conditions array
  const conditions = []

  // Deleted posts filter
  if (showDeleted) {
    // Only show posts deleted within the last 30 days (restorable window)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    conditions.push(isNotNull(posts.deletedAt))
    conditions.push(sql`${posts.deletedAt} >= ${thirtyDaysAgo}`)
  } else {
    conditions.push(isNull(posts.deletedAt))
  }

  // Exclude merged/duplicate posts from inbox listing
  conditions.push(isNull(posts.canonicalPostId))

  // Board filter
  if (boardIds?.length) {
    conditions.push(inArray(posts.boardId, boardIds))
  }

  // Status filter - use subquery to resolve slugs inline if needed
  if (statusSlugs && statusSlugs.length > 0) {
    // Use subquery to resolve status slugs to IDs in a single query
    const statusIdSubquery = db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(inArray(postStatuses.slug, statusSlugs))
    conditions.push(inArray(posts.statusId, statusIdSubquery))
  } else if (statusIds && statusIds.length > 0) {
    conditions.push(inArray(posts.statusId, statusIds))
  }

  // Owner filter
  if (ownerId === null) {
    conditions.push(sql`${posts.ownerPrincipalId} IS NULL`)
  } else if (ownerId) {
    conditions.push(eq(posts.ownerPrincipalId, ownerId as PrincipalId))
  }

  // Search filter
  // Full-text search using tsvector (much faster than ILIKE)
  if (search) {
    conditions.push(sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${search})`)
  }

  // Date range filters
  if (dateFrom) {
    conditions.push(sql`${posts.createdAt} >= ${dateFrom.toISOString()}`)
  }
  if (dateTo) {
    conditions.push(sql`${posts.createdAt} <= ${dateTo.toISOString()}`)
  }

  // Min votes filter
  if (minVotes !== undefined && minVotes > 0) {
    conditions.push(sql`${posts.voteCount} >= ${minVotes}`)
  }

  // Min comments filter
  if (minComments !== undefined && minComments > 0) {
    conditions.push(sql`${posts.commentCount} >= ${minComments}`)
  }

  // Tag filter - use subquery to find posts with at least one of the selected tags
  if (tagIds && tagIds.length > 0) {
    const postIdsWithTagsSubquery = db
      .selectDistinct({ postId: postTags.postId })
      .from(postTags)
      .where(inArray(postTags.tagId, tagIds))
    conditions.push(inArray(posts.id, postIdsWithTagsSubquery))
  }

  // Segment filter - posts authored by users in any of the selected segments
  if (segmentIds && segmentIds.length > 0) {
    conditions.push(
      inArray(
        posts.principalId,
        db
          .select({ principalId: userSegments.principalId })
          .from(userSegments)
          .where(inArray(userSegments.segmentId, segmentIds))
      )
    )
  }

  // Responded filter - filter by whether any team member has commented
  // NOTE: Use raw SQL column names for the comments table inside the subquery.
  // Drizzle's relational query builder (db.query.posts.findMany) rewrites all
  // column references to use the outer table's alias, so ${comments.postId}
  // becomes "posts"."post_id" instead of "comments"."post_id".
  if (responded === 'responded') {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM comments WHERE comments.post_id = ${posts.id} AND comments.is_team_member = true AND comments.deleted_at IS NULL)`
    )
  } else if (responded === 'unresponded') {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM comments WHERE comments.post_id = ${posts.id} AND comments.is_team_member = true AND comments.deleted_at IS NULL)`
    )
  }

  // Updated before filter (for "stale" view)
  if (updatedBefore) {
    conditions.push(sql`${posts.updatedAt} < ${updatedBefore.toISOString()}`)
  }

  // Cursor-based keyset pagination: resolve cursor to sort-field values
  if (cursor) {
    const cursorPost = await db.query.posts.findFirst({
      where: eq(posts.id, cursor as PostId),
      columns: { id: true, createdAt: true, voteCount: true },
    })
    if (cursorPost) {
      const cursorDate = cursorPost.createdAt.toISOString()
      const cursorUuid = toUuid(cursorPost.id)
      if (sort === 'votes') {
        conditions.push(
          sql`(${posts.voteCount}, ${posts.createdAt}, ${posts.id}) < (${cursorPost.voteCount}, ${cursorDate}, ${cursorUuid}::uuid)`
        )
      } else if (sort === 'oldest') {
        conditions.push(
          sql`(${posts.createdAt}, ${posts.id}) > (${cursorDate}, ${cursorUuid}::uuid)`
        )
      } else {
        // newest (default)
        conditions.push(
          sql`(${posts.createdAt}, ${posts.id}) < (${cursorDate}, ${cursorUuid}::uuid)`
        )
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Sort order with id tiebreaker for deterministic keyset pagination
  const orderByMap = {
    newest: [desc(posts.createdAt), desc(posts.id)],
    oldest: [asc(posts.createdAt), asc(posts.id)],
    votes: [desc(posts.voteCount), desc(posts.createdAt), desc(posts.id)],
  }

  // Fetch limit+1 to determine hasMore without a COUNT query
  const rawPosts = await db.query.posts.findMany({
    columns: {
      id: true,
      boardId: true,
      title: true,
      content: true,
      contentJson: true,
      principalId: true,
      statusId: true,
      ownerPrincipalId: true,
      voteCount: true,
      commentCount: true,
      pinnedCommentId: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      isCommentsLocked: true,
      moderationState: true,
      canonicalPostId: true,
      mergedAt: true,
      summaryJson: true,
      summaryUpdatedAt: true,
    },
    where: whereClause,
    orderBy: orderByMap[sort],
    limit: limit + 1,
    with: {
      board: {
        columns: { id: true, name: true, slug: true },
      },
      tags: {
        with: {
          tag: {
            columns: { id: true, name: true, color: true },
          },
        },
      },
      author: {
        columns: { displayName: true },
      },
    },
  })

  const hasMore = rawPosts.length > limit
  const sliced = hasMore ? rawPosts.slice(0, limit) : rawPosts

  // Transform to PostListItem format
  // Use denormalized commentCount field (maintained by comment.service.ts)
  // Cast needed: columns selection omits heavy fields (embedding, searchVector, etc.)
  // that no caller reads from list items, but PostListItem extends the full Post type.
  const items = sliced.map((post) => ({
    ...post,
    board: post.board,
    tags: post.tags.map((pt) => pt.tag),
    commentCount: post.commentCount,
    authorName: post.author?.displayName ?? null,
  })) as unknown as PostListItem[]

  const lastItem = items[items.length - 1]
  const nextCursor = hasMore && lastItem ? lastItem.id : null

  return {
    items,
    nextCursor,
    hasMore,
  }
}
