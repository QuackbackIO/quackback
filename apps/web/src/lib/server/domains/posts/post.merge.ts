/**
 * Post Merge Service - Deduplication and merge-forward operations
 *
 * Handles merging duplicate feedback posts into canonical posts,
 * with aggregated vote counts and reversible operations.
 *
 * Key behaviors:
 * - Merging links posts (no data is deleted)
 * - Vote counts are recalculated to reflect unique voters across merged posts
 * - All merge operations are reversible via unmerge
 * - Only admins can merge/unmerge (enforced at the server function layer)
 */

import {
  db,
  posts,
  votes,
  boards,
  eq,
  and,
  isNull,
  sql,
  principal as principalTable,
  user as userTable,
} from '@/lib/server/db'
import { type PostId, type PrincipalId, toUuid } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import type {
  MergePostResult,
  UnmergePostResult,
  MergedPostSummary,
  PostMergeInfo,
} from './post.types'

/**
 * Merge a duplicate post into a canonical post.
 *
 * - Validates both posts exist and are not deleted
 * - Prevents circular merges and self-merges
 * - Prevents merging a post that is already merged elsewhere
 * - Prevents merging into a post that is itself merged
 * - Sets canonicalPostId, mergedAt, mergedByPrincipalId on the duplicate
 * - Recalculates the canonical post's voteCount to reflect unique voters
 *
 * @param duplicatePostId - The post to mark as a duplicate
 * @param canonicalPostId - The canonical post to merge into
 * @param actorPrincipalId - The admin performing the merge
 */
export async function mergePost(
  duplicatePostId: PostId,
  canonicalPostId: PostId,
  actorPrincipalId: PrincipalId
): Promise<MergePostResult> {
  // Prevent self-merge
  if (duplicatePostId === canonicalPostId) {
    throw new ValidationError('INVALID_MERGE', 'A post cannot be merged into itself')
  }

  // Fetch both posts in parallel
  const [duplicatePost, canonicalPost] = await Promise.all([
    db.query.posts.findFirst({
      where: and(eq(posts.id, duplicatePostId), isNull(posts.deletedAt)),
    }),
    db.query.posts.findFirst({
      where: and(eq(posts.id, canonicalPostId), isNull(posts.deletedAt)),
    }),
  ])

  if (!duplicatePost) {
    throw new NotFoundError('POST_NOT_FOUND', `Duplicate post with ID ${duplicatePostId} not found`)
  }
  if (!canonicalPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Canonical post with ID ${canonicalPostId} not found`)
  }

  // Prevent merging a post that is already merged
  if (duplicatePost.canonicalPostId) {
    throw new ConflictError(
      'ALREADY_MERGED',
      'This post is already merged into another post. Unmerge it first.'
    )
  }

  // Prevent merging into a post that is itself merged (must be a true canonical)
  if (canonicalPost.canonicalPostId) {
    throw new ValidationError(
      'INVALID_MERGE_TARGET',
      'Cannot merge into a post that is itself merged. Choose the canonical post instead.'
    )
  }

  // Mark the duplicate post as merged
  await db
    .update(posts)
    .set({
      canonicalPostId: canonicalPostId,
      mergedAt: new Date(),
      mergedByPrincipalId: actorPrincipalId,
    })
    .where(eq(posts.id, duplicatePostId))

  // Recalculate canonical post's vote count
  const newVoteCount = await recalculateCanonicalVoteCount(canonicalPostId)

  return {
    canonicalPost: { id: canonicalPostId, voteCount: newVoteCount },
    duplicatePost: { id: duplicatePostId },
  }
}

/**
 * Unmerge a previously merged post, restoring it to independent state.
 *
 * - Validates the post exists and is currently merged
 * - Clears canonicalPostId, mergedAt, mergedByPrincipalId
 * - Recalculates the canonical post's voteCount
 *
 * @param postId - The merged post to restore
 * @param actorPrincipalId - The admin performing the unmerge
 */
export async function unmergePost(
  postId: PostId,
  _actorPrincipalId: PrincipalId
): Promise<UnmergePostResult> {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
  })

  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (!post.canonicalPostId) {
    throw new ValidationError('NOT_MERGED', 'This post is not currently merged into another post')
  }

  const canonicalPostId = post.canonicalPostId as PostId

  // Clear merge fields
  await db
    .update(posts)
    .set({
      canonicalPostId: null,
      mergedAt: null,
      mergedByPrincipalId: null,
    })
    .where(eq(posts.id, postId))

  // Recalculate canonical post's vote count
  const newVoteCount = await recalculateCanonicalVoteCount(canonicalPostId)

  return {
    post: { id: postId },
    canonicalPost: { id: canonicalPostId, voteCount: newVoteCount },
  }
}

/**
 * Get all posts that have been merged into a canonical post.
 *
 * @param canonicalPostId - The canonical post to get merged posts for
 * @returns Array of merged post summaries
 */
export async function getMergedPosts(canonicalPostId: PostId): Promise<MergedPostSummary[]> {
  const mergedPosts = await db
    .select({
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      createdAt: posts.createdAt,
      mergedAt: posts.mergedAt,
      authorName: sql<string | null>`(
        SELECT u.name FROM ${principalTable} m
        INNER JOIN ${userTable} u ON m.user_id = u.id
        WHERE m.id = ${posts.principalId}
      )`.as('author_name'),
    })
    .from(posts)
    .where(and(eq(posts.canonicalPostId, canonicalPostId), isNull(posts.deletedAt)))
    .orderBy(posts.mergedAt)

  return mergedPosts.map((p) => ({
    id: p.id,
    title: p.title,
    voteCount: p.voteCount,
    authorName: p.authorName,
    createdAt: p.createdAt,
    mergedAt: p.mergedAt!,
  }))
}

/**
 * Get merge info for a post that has been merged into another.
 * Returns null if the post is not merged.
 *
 * @param postId - The post to check
 * @returns Merge info or null
 */
export async function getPostMergeInfo(postId: PostId): Promise<PostMergeInfo | null> {
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { canonicalPostId: true, mergedAt: true },
  })

  if (!post?.canonicalPostId || !post.mergedAt) {
    return null
  }

  const canonicalPost = await db
    .select({
      id: posts.id,
      title: posts.title,
      boardSlug: boards.slug,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(eq(posts.id, post.canonicalPostId))
    .limit(1)

  if (!canonicalPost[0]) {
    return null
  }

  return {
    canonicalPostId: canonicalPost[0].id,
    canonicalPostTitle: canonicalPost[0].title,
    canonicalPostBoardSlug: canonicalPost[0].boardSlug,
    mergedAt: post.mergedAt,
  }
}

/**
 * Recalculate the vote count for a canonical post.
 * Counts unique voters across the canonical post and all its merged duplicates.
 *
 * @param canonicalPostId - The canonical post to recalculate
 * @returns The new vote count
 */
async function recalculateCanonicalVoteCount(canonicalPostId: PostId): Promise<number> {
  // Count unique member votes across canonical + all merged duplicates
  // Note: must convert TypeID to raw UUID for use in raw SQL
  const canonicalUuid = toUuid(canonicalPostId)
  const result = await db.execute<{ unique_voters: number }>(sql`
    WITH related_post_ids AS (
      SELECT ${canonicalUuid}::uuid AS post_id
      UNION ALL
      SELECT id FROM ${posts}
      WHERE canonical_post_id = ${canonicalUuid}::uuid
        AND deleted_at IS NULL
    )
    SELECT COUNT(DISTINCT v.principal_id)::int AS unique_voters
    FROM ${votes} v
    WHERE v.post_id IN (SELECT post_id FROM related_post_ids)
  `)

  const rows = getExecuteRows<{ unique_voters: number }>(result)
  const newCount = rows[0]?.unique_voters ?? 0

  // Update the canonical post's vote count
  await db.update(posts).set({ voteCount: newCount }).where(eq(posts.id, canonicalPostId))

  return newCount
}

/**
 * Safely extract rows from db.execute() result.
 * Handles both postgres-js (array directly) and neon-http ({ rows: [...] }) formats.
 */
function getExecuteRows<T>(result: unknown): T[] {
  if (
    result &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows
  }
  if (Array.isArray(result)) {
    return result as T[]
  }
  return []
}
