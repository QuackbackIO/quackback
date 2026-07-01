/**
 * Comment Reaction Operations
 *
 * Handles adding and removing emoji reactions on comments.
 */

import { db, eq, and, postCommentReactions, principal } from '@/lib/server/db'
import { type PostCommentId, type PrincipalId } from '@quackback/ids'
import { aggregateReactions } from '@/lib/shared'
import { type Actor } from '@/lib/server/policy'
import { assertCommentViewable } from '@/lib/server/domains/posts/post.access'
import type { CommentReactionCount, ReactionResult } from './comment.types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'comment-reactions' })

/** Load a comment's reactions aggregated with the reactors' display names (for
 *  the hover tooltip) and the viewer's hasReacted flag. */
async function aggregatedReactionsFor(
  commentId: PostCommentId,
  viewerPrincipalId: PrincipalId
): Promise<CommentReactionCount[]> {
  const rows = await db
    .select({
      emoji: postCommentReactions.emoji,
      principalId: postCommentReactions.principalId,
      displayName: principal.displayName,
    })
    .from(postCommentReactions)
    .leftJoin(principal, eq(principal.id, postCommentReactions.principalId))
    .where(eq(postCommentReactions.commentId, commentId))
  return aggregateReactions(rows, viewerPrincipalId)
}

/**
 * Add a reaction to a comment
 *
 * If the user has already reacted with this emoji, this is a no-op.
 * The actual toggle behavior is handled by the database unique constraint.
 *
 * @param commentId - Comment ID to react to
 * @param emoji - Emoji to add
 * @param principalId - Principal ID (required - auth only)
 * @returns Result containing reaction status or an error
 */
export async function addReaction(
  commentId: PostCommentId,
  emoji: string,
  principalId: PrincipalId,
  actor: Actor
): Promise<ReactionResult> {
  log.info({ comment_id: commentId, emoji }, 'add reaction')
  // Single chokepoint for comment access: audience + moderation +
  // isPrivate + isNull(deletedAt) on comment/post/board. Previously this
  // function did its own canViewPost+isPrivate inline but didn't check
  // any of the deletedAt columns — so a reaction could be added to a
  // soft-deleted comment / post / board.
  await assertCommentViewable(commentId, actor)

  // Atomically insert reaction (uses unique constraint to prevent duplicates)
  const inserted = await db
    .insert(postCommentReactions)
    .values({
      commentId,
      principalId,
      emoji,
    })
    .onConflictDoNothing()
    .returning()

  const added = inserted.length > 0

  return { added, reactions: await aggregatedReactionsFor(commentId, principalId) }
}

/**
 * Remove a reaction from a comment
 *
 * If the user hasn't reacted with this emoji, this is a no-op.
 *
 * @param commentId - Comment ID to remove reaction from
 * @param emoji - Emoji to remove
 * @param principalId - Principal ID (required - auth only)
 * @returns Result containing reaction status or an error
 */
export async function removeReaction(
  commentId: PostCommentId,
  emoji: string,
  principalId: PrincipalId,
  actor: Actor
): Promise<ReactionResult> {
  log.info({ comment_id: commentId, emoji }, 'remove reaction')
  // Same chokepoint as addReaction — see notes there.
  await assertCommentViewable(commentId, actor)

  // Directly delete (no need to check first - idempotent operation)
  await db
    .delete(postCommentReactions)
    .where(
      and(
        eq(postCommentReactions.commentId, commentId),
        eq(postCommentReactions.principalId, principalId),
        eq(postCommentReactions.emoji, emoji)
      )
    )

  return { added: false, reactions: await aggregatedReactionsFor(commentId, principalId) }
}
