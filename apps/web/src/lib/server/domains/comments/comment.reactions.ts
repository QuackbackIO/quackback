/**
 * Comment Reaction Operations
 *
 * Handles adding and removing emoji reactions on comments.
 */

import { db, eq, and, comments, commentReactions } from '@/lib/server/db'
import { type CommentId, type PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { aggregateReactions } from '@/lib/shared'
import type { ReactionResult } from './comment.types'

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
  commentId: CommentId,
  emoji: string,
  principalId: PrincipalId
): Promise<ReactionResult> {
  console.log(`[domain:comments] addReaction: commentId=${commentId}, emoji=${emoji}`)
  // Verify comment exists with post and board in single query
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    with: {
      post: {
        with: { board: true },
      },
    },
  })
  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }
  if (!comment.post || !comment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${comment.postId} not found`)
  }

  // Atomically insert reaction (uses unique constraint to prevent duplicates)
  const inserted = await db
    .insert(commentReactions)
    .values({
      commentId,
      principalId,
      emoji,
    })
    .onConflictDoNothing()
    .returning()

  const added = inserted.length > 0

  // Fetch updated reactions
  const reactions = await db.query.commentReactions.findMany({
    where: eq(commentReactions.commentId, commentId),
  })

  const aggregatedReactions = aggregateReactions(
    reactions.map((r) => ({
      emoji: r.emoji,
      principalId: r.principalId,
    })),
    principalId
  )

  return { added, reactions: aggregatedReactions }
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
  commentId: CommentId,
  emoji: string,
  principalId: PrincipalId
): Promise<ReactionResult> {
  console.log(`[domain:comments] removeReaction: commentId=${commentId}, emoji=${emoji}`)
  // Verify comment exists with post and board in single query
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    with: {
      post: {
        with: { board: true },
      },
    },
  })
  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }
  if (!comment.post || !comment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${comment.postId} not found`)
  }

  // Directly delete (no need to check first - idempotent operation)
  await db
    .delete(commentReactions)
    .where(
      and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.principalId, principalId),
        eq(commentReactions.emoji, emoji)
      )
    )

  // Fetch updated reactions
  const reactions = await db.query.commentReactions.findMany({
    where: eq(commentReactions.commentId, commentId),
  })

  const aggregatedReactions = aggregateReactions(
    reactions.map((r) => ({
      emoji: r.emoji,
      principalId: r.principalId,
    })),
    principalId
  )

  return { added: false, reactions: aggregatedReactions }
}
