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
} from '@/lib/server/db'
import { type BoardId, type PostId, type PrincipalId, type UserId, toUuid } from '@featurepool/ids'
import { scheduleDispatch } from '@/lib/server/events/scheduler'
import { getExecuteRows } from '@/lib/server/utils'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import {
  dispatchPostMerged,
  dispatchPostUnmerged,
  buildEventActor,
} from '@/lib/server/events/dispatch'
import { getPostWithDetails, getCommentsWithReplies } from './post.query'
import { hasUserVoted } from './post.public.utils'
import type {
  MergePostResult,
  UnmergePostResult,
  MergedPostSummary,
  PostMergeInfo,
  PostWithDetails,
} from './post.types'
import type { CommentTreeNode } from '@/lib/shared'

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
  actorPrincipalId: PrincipalId,
  actorUserId?: UserId
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

  // Recalculate canonical post's vote count and reset merge check in one update
  const newVoteCount = await recalculateCanonicalVoteCount(canonicalPostId, {
    resetMergeCheck: true,
  })

  // Queue a delayed re-check for additional duplicates (e.g. 3 similar posts where only 1 was caught)
  schedulePostMergeRecheck(canonicalPostId)

  // Look up the duplicate post's author name for activity metadata
  const duplicateAuthor = duplicatePost.principalId
    ? await db.query.principal.findFirst({
        where: eq(principalTable.id, duplicatePost.principalId),
        columns: { displayName: true },
      })
    : null

  // Record activity on both posts
  createActivity({
    postId: canonicalPostId,
    principalId: actorPrincipalId,
    type: 'post.merged_in',
    metadata: {
      duplicatePostId,
      duplicatePostTitle: duplicatePost.title,
      duplicateVoteCount: duplicatePost.voteCount,
      duplicateAuthorName: duplicateAuthor?.displayName ?? null,
    },
  })
  createActivity({
    postId: duplicatePostId,
    principalId: actorPrincipalId,
    type: 'post.merged_away',
    metadata: { canonicalPostId, canonicalPostTitle: canonicalPost.title },
  })

  // Dispatch post.merged event for webhooks and integrations
  const [dupBoard, canBoard] = await Promise.all([
    db.query.boards.findFirst({
      where: eq(boards.id, duplicatePost.boardId),
      columns: { slug: true },
    }),
    db.query.boards.findFirst({
      where: eq(boards.id, canonicalPost.boardId),
      columns: { slug: true },
    }),
  ])
  if (dupBoard && canBoard) {
    dispatchPostMerged(
      buildEventActor({ principalId: actorPrincipalId, userId: actorUserId }),
      {
        id: duplicatePostId,
        title: duplicatePost.title,
        boardId: duplicatePost.boardId,
        boardSlug: dupBoard.slug,
      },
      {
        id: canonicalPostId,
        title: canonicalPost.title,
        boardId: canonicalPost.boardId,
        boardSlug: canBoard.slug,
      }
    )
  }

  return {
    canonicalPost: { id: canonicalPostId, voteCount: newVoteCount },
    duplicatePost: { id: duplicatePostId },
  }
}

/**
 * Schedule a delayed duplicate re-check for a canonical post after merge.
 * Uses BullMQ for persistence and retry. The 3s delay lets the DB transaction
 * settle and avoids re-finding just-dismissed suggestions.
 */
function schedulePostMergeRecheck(canonicalPostId: PostId): void {
  scheduleDispatch({
    jobId: `merge-recheck:${canonicalPostId}`,
    handler: '__post_merge_recheck__',
    delayMs: 3000,
    payload: { postId: canonicalPostId },
  }).catch((err) =>
    console.error(`[PostMerge] Failed to schedule recheck for ${canonicalPostId}:`, err)
  )
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
  actorPrincipalId: PrincipalId,
  actorUserId?: UserId
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

  // Clear merge fields and reset merge check so the post gets re-evaluated
  await db
    .update(posts)
    .set({
      canonicalPostId: null,
      mergedAt: null,
      mergedByPrincipalId: null,
      mergeCheckedAt: null,
    })
    .where(eq(posts.id, postId))

  // Recalculate canonical post's vote count
  const newVoteCount = await recalculateCanonicalVoteCount(canonicalPostId)

  // Look up the canonical post title and board for the activity metadata and event
  const canonicalPost = await db.query.posts.findFirst({
    where: eq(posts.id, canonicalPostId),
    columns: { title: true, boardId: true },
  })

  // Record activity on both posts
  createActivity({
    postId,
    principalId: actorPrincipalId,
    type: 'post.unmerged',
    metadata: { otherPostId: canonicalPostId, otherPostTitle: canonicalPost?.title ?? '' },
  })
  createActivity({
    postId: canonicalPostId,
    principalId: actorPrincipalId,
    type: 'post.unmerged',
    metadata: { otherPostId: postId, otherPostTitle: post.title },
  })

  // Dispatch post.unmerged event for webhooks and integrations
  if (canonicalPost) {
    const [postBoard, canonicalBoard] = await Promise.all([
      db.query.boards.findFirst({
        where: eq(boards.id, post.boardId),
        columns: { slug: true },
      }),
      db.query.boards.findFirst({
        where: eq(boards.id, canonicalPost.boardId as BoardId),
        columns: { slug: true },
      }),
    ])
    if (postBoard && canonicalBoard) {
      dispatchPostUnmerged(
        buildEventActor({ principalId: actorPrincipalId, userId: actorUserId }),
        {
          id: postId,
          title: post.title,
          boardId: post.boardId,
          boardSlug: postBoard.slug,
        },
        {
          id: canonicalPostId,
          title: canonicalPost.title,
          boardId: canonicalPost.boardId as BoardId,
          boardSlug: canonicalBoard.slug,
        }
      )
    }
  }

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
        SELECT m.display_name FROM ${principalTable} m
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
 * Result of a merge preview — simulates what the canonical post would look like after merging.
 */
export interface MergePreviewResult {
  /** Canonical post with full details (vote count reflects deduplicated merge) */
  post: PostWithDetails & {
    hasVoted: boolean
    comments: CommentTreeNode[]
    mergedPosts?: undefined
    mergeInfo?: undefined
  }
  /** Comments from the duplicate post (shown under a divider in the UI) */
  duplicateComments: CommentTreeNode[]
  /** Title of the duplicate post (used for the divider label) */
  duplicatePostTitle: string
}

/**
 * Preview what the merged post would look like without actually performing the merge.
 *
 * Loads full details for both posts, computes the deduplicated vote count
 * (same logic as recalculateCanonicalVoteCount), and returns separate comment
 * arrays so the UI can show them with a divider.
 *
 * @param canonicalPostId - The post that would remain after merge
 * @param duplicatePostId - The post that would be absorbed
 * @param viewerPrincipalId - The principal viewing the preview (for hasVoted check)
 */
export async function previewMergedPost(
  canonicalPostId: PostId,
  duplicatePostId: PostId,
  viewerPrincipalId: PrincipalId
): Promise<MergePreviewResult> {
  // Load both posts' full details and comments in parallel
  const [canonicalDetails, duplicateDetails, canonicalComments, duplicateComments, hasVoted] =
    await Promise.all([
      getPostWithDetails(canonicalPostId),
      getPostWithDetails(duplicatePostId),
      getCommentsWithReplies(canonicalPostId, viewerPrincipalId),
      getCommentsWithReplies(duplicatePostId, viewerPrincipalId),
      hasUserVoted(canonicalPostId, viewerPrincipalId),
    ])

  // Compute deduplicated vote count across both posts (same SQL as real merge)
  const canonicalUuid = toUuid(canonicalPostId)
  const duplicateUuid = toUuid(duplicatePostId)
  const result = await db.execute<{ unique_voters: number }>(sql`
    SELECT COUNT(DISTINCT v.principal_id)::int AS unique_voters
    FROM ${votes} v
    WHERE v.post_id IN (${canonicalUuid}::uuid, ${duplicateUuid}::uuid)
  `)
  const rows = getExecuteRows<{ unique_voters: number }>(result)
  const mergedVoteCount = rows[0]?.unique_voters ?? 0

  // Combine comment counts from both posts
  const combinedCommentCount = canonicalDetails.commentCount + duplicateDetails.commentCount

  return {
    post: {
      ...canonicalDetails,
      voteCount: mergedVoteCount,
      commentCount: combinedCommentCount,
      hasVoted,
      comments: canonicalComments,
    },
    duplicateComments,
    duplicatePostTitle: duplicateDetails.title,
  }
}

/**
 * Recalculate the vote count for a canonical post.
 * Counts unique voters across the canonical post and all its merged duplicates.
 *
 * @param canonicalPostId - The canonical post to recalculate
 * @returns The new vote count
 */
async function recalculateCanonicalVoteCount(
  canonicalPostId: PostId,
  options?: { resetMergeCheck?: boolean }
): Promise<number> {
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

  // Update the canonical post's vote count (and optionally reset mergeCheckedAt)
  await db
    .update(posts)
    .set({
      voteCount: newCount,
      ...(options?.resetMergeCheck && { mergeCheckedAt: null }),
    })
    .where(eq(posts.id, canonicalPostId))

  return newCount
}
