/**
 * Post Inbox Query
 *
 * Handles the admin inbox listing with advanced filtering and cursor-based pagination.
 */

import {
  db,
  posts,
  postStatuses,
  postTagAssignments,
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
import type {
  PostListItem,
  InboxPostListParams,
  InboxPostListResult,
  InboxFilterCounts,
} from './post.types'

/** Facet whose own filter is skipped when counting that facet's options. */
export type InboxFilterFacet = 'status' | 'board' | 'tags' | 'segments' | 'responded' | 'deleted'

const RESTORABLE_DELETED_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Team-member comment exists. Raw SQL table/column names — Drizzle's
 * relational query builder rewrites `${postComments.postId}` onto the outer
 * posts alias, producing `"posts"."post_id"`.
 */
const teamResponseExistsSql = sql`EXISTS (SELECT 1 FROM post_comments WHERE post_comments.post_id = ${posts.id} AND post_comments.is_team_member = true AND post_comments.deleted_at IS NULL)`

function restorableDeletedConditions() {
  const thirtyDaysAgo = new Date(Date.now() - RESTORABLE_DELETED_MS).toISOString()
  return [isNotNull(posts.deletedAt), sql`${posts.deletedAt} >= ${thirtyDaysAgo}`]
}

function toCountMap(rows: Array<{ key: string | null; count: number }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    if (row.key != null) out[row.key] = Number(row.count) || 0
  }
  return out
}

/**
 * Shared inbox WHERE predicates. `omit` drops one dimension so facet counts
 * for that dimension stay disjunctive: other applied filters still constrain
 * the count, and the count for an unselected option is the number of posts
 * that would newly match if that option were selected (or added).
 */
export function inboxFilterConditions(params: InboxPostListParams, omit?: InboxFilterFacet) {
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
  } = params

  const conditions = []

  if (omit !== 'deleted') {
    if (showDeleted) {
      conditions.push(...restorableDeletedConditions())
    } else {
      conditions.push(isNull(posts.deletedAt))
      // Pending posts render in the inbox for team members (who hold
      // post.approve / post.view_private) so they can review them in place.
      // The moderation queue still lists the same items for attention.
    }
  }

  // Exclude merged/duplicate posts from inbox listing
  conditions.push(isNull(posts.canonicalPostId))

  if (omit !== 'board' && boardIds?.length) {
    conditions.push(inArray(posts.boardId, boardIds))
  }

  if (omit !== 'status') {
    if (statusSlugs && statusSlugs.length > 0) {
      const statusIdSubquery = db
        .select({ id: postStatuses.id })
        .from(postStatuses)
        .where(inArray(postStatuses.slug, statusSlugs))
      conditions.push(inArray(posts.statusId, statusIdSubquery))
    } else if (statusIds && statusIds.length > 0) {
      conditions.push(inArray(posts.statusId, statusIds))
    }
  }

  if (ownerId === null) {
    conditions.push(sql`${posts.ownerPrincipalId} IS NULL`)
  } else if (ownerId) {
    conditions.push(eq(posts.ownerPrincipalId, ownerId as PrincipalId))
  }

  if (search) {
    conditions.push(sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${search})`)
  }

  if (dateFrom) {
    conditions.push(sql`${posts.createdAt} >= ${dateFrom.toISOString()}`)
  }
  if (dateTo) {
    conditions.push(sql`${posts.createdAt} <= ${dateTo.toISOString()}`)
  }

  if (minVotes !== undefined && minVotes > 0) {
    conditions.push(sql`${posts.voteCount} >= ${minVotes}`)
  }

  if (minComments !== undefined && minComments > 0) {
    conditions.push(sql`${posts.commentCount} >= ${minComments}`)
  }

  if (omit !== 'tags' && tagIds && tagIds.length > 0) {
    const postIdsWithTagsSubquery = db
      .selectDistinct({ postId: postTagAssignments.postId })
      .from(postTagAssignments)
      .where(inArray(postTagAssignments.tagId, tagIds))
    conditions.push(inArray(posts.id, postIdsWithTagsSubquery))
  }

  if (omit !== 'segments' && segmentIds && segmentIds.length > 0) {
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

  if (omit !== 'responded') {
    if (responded === 'responded') {
      conditions.push(teamResponseExistsSql)
    } else if (responded === 'unresponded') {
      conditions.push(
        sql`NOT EXISTS (SELECT 1 FROM post_comments WHERE post_comments.post_id = ${posts.id} AND post_comments.is_team_member = true AND post_comments.deleted_at IS NULL)`
      )
    }
  }

  if (updatedBefore) {
    conditions.push(sql`${posts.updatedAt} < ${updatedBefore.toISOString()}`)
  }

  return conditions
}

/**
 * Priority score: `votes · 3 + comments · 2 + recency bonus`, where the
 * recency bonus starts at 30 for a brand-new post and decays linearly to 0
 * at 30 days old. Votes outweigh comments (a vote is the broader demand
 * signal); the bounded bonus keeps fresh posts visible without letting age
 * alone permanently outrank a strongly-voted post. Computed in SQL so
 * sorting and keyset pagination share one formula.
 */
const priorityScoreSql = sql<number>`
  ${posts.voteCount} * 3
  + ${posts.commentCount} * 2
  + GREATEST(0, 30 - EXTRACT(EPOCH FROM (now() - ${posts.createdAt})) / 86400)
`

/**
 * List posts for admin inbox with advanced filtering
 *
 * @param params - Query parameters including filters, sort, and pagination
 * @returns Result containing inbox post list or an error
 */
export async function listInboxPosts(params: InboxPostListParams): Promise<InboxPostListResult> {
  const { sort = 'newest', cursor, limit = 20 } = params

  const conditions = inboxFilterConditions(params)

  // Cursor-based keyset pagination: resolve cursor to sort-field values
  if (cursor) {
    const cursorPost = await db.query.posts.findFirst({
      where: eq(posts.id, cursor as PostId),
      columns: { id: true, createdAt: true, voteCount: true },
    })
    if (cursorPost) {
      const cursorDate = cursorPost.createdAt.toISOString()
      const cursorUuid = toUuid(cursorPost.id)
      if (sort === 'priority') {
        // Keyset on the computed score: look up the cursor post's score with
        // the same expression the ORDER BY uses.
        const [scoreRow] = await db
          .select({ score: priorityScoreSql })
          .from(posts)
          .where(eq(posts.id, cursor as PostId))
        if (scoreRow) {
          conditions.push(
            sql`(${priorityScoreSql}, ${posts.createdAt}, ${posts.id}) < (${scoreRow.score}, ${cursorDate}, ${cursorUuid}::uuid)`
          )
        }
      } else if (sort === 'votes') {
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
    priority: [desc(priorityScoreSql), desc(posts.createdAt), desc(posts.id)],
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
    tags: post.tags.map((pt) => ({ ...pt.tag, autoTagged: pt.autoTagged })),
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

/**
 * Facet counts for the inbox filter pane. One grouped query per dimension,
 * each omitting that dimension's own filter so counts stay disjunctive.
 */
export async function countInboxFilterFacets(
  params: InboxPostListParams
): Promise<InboxFilterCounts> {
  const countSql = sql<number>`count(*)::int`
  const teamRespondedFilter = sql<number>`count(*) filter (where exists (select 1 from post_comments where post_comments.post_id = ${posts.id} and post_comments.is_team_member = true and post_comments.deleted_at is null))::int`
  const teamUnrespondedFilter = sql<number>`count(*) filter (where not exists (select 1 from post_comments where post_comments.post_id = ${posts.id} and post_comments.is_team_member = true and post_comments.deleted_at is null))::int`

  const [statusRows, boardRows, tagRows, segmentRows, respondedRow, deletedRow] = await Promise.all(
    [
      db
        .select({ key: postStatuses.slug, count: countSql })
        .from(posts)
        .innerJoin(postStatuses, eq(posts.statusId, postStatuses.id))
        .where(and(...inboxFilterConditions(params, 'status')))
        .groupBy(postStatuses.slug),
      db
        .select({ key: posts.boardId, count: countSql })
        .from(posts)
        .where(and(...inboxFilterConditions(params, 'board')))
        .groupBy(posts.boardId),
      db
        .select({ key: postTagAssignments.tagId, count: countSql })
        .from(posts)
        .innerJoin(postTagAssignments, eq(postTagAssignments.postId, posts.id))
        .where(and(...inboxFilterConditions(params, 'tags')))
        .groupBy(postTagAssignments.tagId),
      db
        .select({ key: userSegments.segmentId, count: countSql })
        .from(posts)
        .innerJoin(userSegments, eq(userSegments.principalId, posts.principalId))
        .where(and(...inboxFilterConditions(params, 'segments')))
        .groupBy(userSegments.segmentId),
      db
        .select({ responded: teamRespondedFilter, unresponded: teamUnrespondedFilter })
        .from(posts)
        .where(and(...inboxFilterConditions(params, 'responded')))
        .then((rows) => rows[0] ?? { responded: 0, unresponded: 0 }),
      db
        .select({ count: countSql })
        .from(posts)
        .where(and(...inboxFilterConditions(params, 'deleted'), ...restorableDeletedConditions()))
        .then((rows) => rows[0]?.count ?? 0),
    ]
  )

  return {
    statuses: toCountMap(statusRows),
    boards: toCountMap(boardRows),
    tags: toCountMap(tagRows),
    segments: toCountMap(segmentRows),
    responded: {
      responded: Number(respondedRow.responded) || 0,
      unresponded: Number(respondedRow.unresponded) || 0,
    },
    deleted: Number(deletedRow) || 0,
  }
}
