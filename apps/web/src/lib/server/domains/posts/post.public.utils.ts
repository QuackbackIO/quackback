import {
  db,
  eq,
  and,
  inArray,
  desc,
  sql,
  isNull,
  posts,
  boards,
  postVotes,
  postSubscriptions,
} from '@/lib/server/db'
import { toUuid, type PostId, type StatusId, type PrincipalId } from '@quackback/ids'
import type { RoadmapPostListResult } from './post.types'
import { getExecuteRows } from '@/lib/server/utils'
import { postViewFilter, ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy'

export async function getPublicRoadmapPostsPaginated(params: {
  statusId: StatusId
  page?: number
  limit?: number
  /**
   * Caller's actor — drives board audience + post moderation filtering.
   * Defaults to anonymous so unauthenticated public-roadmap loads still
   * work, but authenticated callers MUST pass their own actor or they
   * silently lose access to authenticated/team/segment boards.
   */
  actor?: Actor
}): Promise<RoadmapPostListResult> {
  const { statusId, page = 1, limit = 10, actor = ANONYMOUS_ACTOR } = params
  const offset = (page - 1) * limit

  const result = await db
    .select({
      id: posts.id,
      title: posts.title,
      statusId: posts.statusId,
      voteCount: posts.voteCount,
      boardId: boards.id,
      boardName: boards.name,
      boardSlug: boards.slug,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(
        postViewFilter(actor),
        eq(posts.statusId, statusId),
        isNull(posts.canonicalPostId),
        isNull(posts.deletedAt),
        // Soft-delete intent applies to the board too — don't surface
        // posts whose board has been deleted via the roadmap status view.
        isNull(boards.deletedAt)
      )
    )
    .orderBy(desc(posts.voteCount))
    .limit(limit + 1)
    .offset(offset)

  const hasMore = result.length > limit
  const trimmedResults = hasMore ? result.slice(0, limit) : result

  const items = trimmedResults.map((row) => ({
    id: row.id,
    title: row.title,
    statusId: row.statusId,
    voteCount: row.voteCount,
    board: {
      id: row.boardId,
      name: row.boardName,
      slug: row.boardSlug,
    },
  }))

  return {
    items,
    total: -1,
    hasMore,
  }
}

export async function hasUserVoted(postId: PostId, principalId: PrincipalId): Promise<boolean> {
  const vote = await db.query.postVotes.findFirst({
    where: and(eq(postVotes.postId, postId), eq(postVotes.principalId, principalId)),
  })
  return !!vote
}

/**
 * Combined query to get vote status AND subscription status in a single DB round-trip.
 * This replaces calling hasUserVoted() and getSubscriptionStatus() separately.
 *
 * Uses a LEFT JOIN approach to guarantee exactly 1 row is returned, avoiding
 * the need for a fallback query when no subscription exists.
 */
export async function getVoteAndSubscriptionStatus(
  postId: PostId,
  principalId: PrincipalId
): Promise<{
  hasVoted: boolean
  subscription: {
    subscribed: boolean
    level: 'all' | 'status_only' | 'none'
    reason: string | null
  }
}> {
  // Convert TypeIDs to UUIDs for raw SQL
  const postUuid = toUuid(postId)
  const principalUuid = toUuid(principalId)

  // Single query that always returns exactly 1 row using a subquery approach
  // This avoids the need for a fallback query when no subscription exists
  const result = await db.execute(sql`
    SELECT
      EXISTS(
        SELECT 1 FROM ${postVotes}
        WHERE ${postVotes.postId} = ${postUuid}::uuid
        AND ${postVotes.principalId} = ${principalUuid}::uuid
      ) as has_voted,
      ps.post_id IS NOT NULL as subscribed,
      ps.notify_comments,
      ps.notify_status_changes,
      ps.reason
    FROM (SELECT 1) AS dummy
    LEFT JOIN ${postSubscriptions} ps
      ON ps.post_id = ${postUuid}::uuid
      AND ps.principal_id = ${principalUuid}::uuid
  `)

  type ResultRow = {
    has_voted: boolean
    subscribed: boolean
    notify_comments: boolean | null
    notify_status_changes: boolean | null
    reason: string | null
  }
  const rows = getExecuteRows<ResultRow>(result)
  const row = rows[0]

  // Determine subscription level from flags
  let level: 'all' | 'status_only' | 'none' = 'none'
  if (row?.subscribed) {
    if (row.notify_comments && row.notify_status_changes) {
      level = 'all'
    } else if (row.notify_status_changes) {
      level = 'status_only'
    }
  }

  return {
    hasVoted: row?.has_voted ?? false,
    subscription: {
      subscribed: row?.subscribed ?? false,
      level,
      reason: row?.reason ?? null,
    },
  }
}

export async function getUserVotedPostIds(
  postIds: PostId[],
  principalId: PrincipalId
): Promise<Set<PostId>> {
  if (postIds.length === 0) {
    return new Set()
  }
  const result = await db
    .select({ postId: postVotes.postId })
    .from(postVotes)
    .where(and(inArray(postVotes.postId, postIds), eq(postVotes.principalId, principalId)))
  return new Set(result.map((r) => r.postId))
}
