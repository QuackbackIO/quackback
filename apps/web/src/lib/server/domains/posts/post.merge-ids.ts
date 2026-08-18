/**
 * Shared "this post + posts merged into it" id set.
 *
 * Merge links the source (`canonical_post_id`) rather than moving votes or
 * comments. Every read/write that should treat a canonical and its sources as
 * one thread (vote identity, voter list, comment/vote recounts) uses this set.
 */
import { db, posts, postVotes, postComments, and, or, eq, isNull, sql } from '@/lib/server/db'
import { toUuid, type PostId } from '@quackback/ids'
import { getExecuteRows } from '@/lib/server/utils'

type TransactionalDb = Pick<typeof db, 'execute' | 'update'>

/**
 * Drizzle subquery of post ids in a merge thread: the given post plus every
 * non-deleted source merged into it. Safe to pass to `inArray`.
 */
export function relatedPostIdsSubquery(postId: PostId) {
  return db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(isNull(posts.deletedAt), or(eq(posts.id, postId), eq(posts.canonicalPostId, postId)))
    )
}

/**
 * Raw-SQL id list for `IN (...)` clauses that already speak UUIDs (the
 * vote/comment recount CTEs, hasVoted EXISTS, etc.).
 */
export function relatedPostIdsSql(postUuid: string) {
  return sql`(
    SELECT ${postUuid}::uuid
    UNION ALL
    SELECT id FROM ${posts}
    WHERE canonical_post_id = ${postUuid}::uuid
      AND deleted_at IS NULL
  )`
}

/**
 * Recount unique voters and public comments across a canonical + its sources.
 * Runs via the transaction handle when called from merge/unmerge so the
 * recount commits atomically with the link change.
 */
export async function recalculateCanonicalVoteCount(
  canonicalPostId: PostId,
  options?: { resetMergeCheck?: boolean },
  tx?: TransactionalDb
): Promise<number> {
  const conn = tx ?? db
  const canonicalUuid = toUuid(canonicalPostId)
  const result = await conn.execute<{ unique_voters: number; visible_comments: number }>(sql`
    WITH related_post_ids AS (
      SELECT ${canonicalUuid}::uuid AS post_id
      UNION ALL
      SELECT id FROM ${posts}
      WHERE canonical_post_id = ${canonicalUuid}::uuid
        AND deleted_at IS NULL
    )
    SELECT
      (
        SELECT COUNT(DISTINCT v.principal_id)::int
        FROM ${postVotes} v
        WHERE v.post_id IN (SELECT post_id FROM related_post_ids)
      ) AS unique_voters,
      (
        SELECT COUNT(*)::int
        FROM ${postComments} c
        WHERE c.post_id IN (SELECT post_id FROM related_post_ids)
          AND c.deleted_at IS NULL
          AND c.is_private = false
          AND c.moderation_state <> 'pending'
      ) AS visible_comments
  `)

  const rows = getExecuteRows<{ unique_voters: number; visible_comments: number }>(result)
  const newCount = rows[0]?.unique_voters ?? 0
  const newCommentCount = rows[0]?.visible_comments ?? 0

  await conn
    .update(posts)
    .set({
      voteCount: newCount,
      commentCount: newCommentCount,
      ...(options?.resetMergeCheck && { mergeCheckedAt: null }),
    })
    .where(eq(posts.id, canonicalPostId))

  return newCount
}
