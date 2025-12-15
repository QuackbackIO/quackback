/**
 * Shared utilities for comment tree building and reaction aggregation.
 * Extracted to avoid duplication between posts.ts and public.ts
 */

import type { CommentId, PostId, MemberId } from '@quackback/ids'
import type { CommentReactionCount } from './public'

/**
 * Raw comment data with reactions from database query
 */
export interface CommentWithReactions {
  id: CommentId
  postId: PostId
  parentId: CommentId | null
  memberId: MemberId | null
  authorId: string | null
  authorName: string | null
  authorEmail: string | null
  content: string
  isTeamMember: boolean
  createdAt: Date
  reactions: Array<{
    emoji: string
    userIdentifier: string
  }>
}

/**
 * Comment node with nested replies and aggregated reactions
 */
export interface CommentNode {
  id: CommentId
  postId: PostId
  parentId: CommentId | null
  memberId: MemberId | null
  authorId: string | null
  authorName: string | null
  authorEmail: string | null
  content: string
  isTeamMember: boolean
  createdAt: Date
  replies: CommentNode[]
  reactions: CommentReactionCount[]
}

/**
 * Aggregate reactions by emoji, tracking whether the current user has reacted.
 *
 * @param reactions - Array of reaction records
 * @param userIdentifier - Optional user identifier to check for current user's reactions
 * @returns Array of aggregated reaction counts
 */
export function aggregateReactions(
  reactions: Array<{ emoji: string; userIdentifier: string }>,
  userIdentifier?: string
): CommentReactionCount[] {
  const reactionCounts = new Map<string, { count: number; hasReacted: boolean }>()

  for (const reaction of reactions) {
    const existing = reactionCounts.get(reaction.emoji) || { count: 0, hasReacted: false }
    existing.count++
    if (userIdentifier && reaction.userIdentifier === userIdentifier) {
      existing.hasReacted = true
    }
    reactionCounts.set(reaction.emoji, existing)
  }

  return Array.from(reactionCounts.entries()).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    hasReacted: data.hasReacted,
  }))
}

/**
 * Build a nested comment tree from a flat list of comments.
 * Uses two-pass algorithm for O(n) complexity.
 *
 * @param comments - Flat array of comments with reactions
 * @param userIdentifier - Optional user identifier for reaction status
 * @returns Array of root comments with nested replies
 */
export function buildCommentTree<T extends CommentWithReactions>(
  comments: T[],
  userIdentifier?: string
): CommentNode[] {
  const commentMap = new Map<CommentId, CommentNode>()
  const rootComments: CommentNode[] = []

  // First pass: create all nodes with aggregated reactions
  for (const comment of comments) {
    const node: CommentNode = {
      id: comment.id,
      postId: comment.postId,
      parentId: comment.parentId,
      memberId: comment.memberId,
      authorId: comment.authorId,
      authorName: comment.authorName,
      authorEmail: comment.authorEmail,
      content: comment.content,
      isTeamMember: comment.isTeamMember,
      createdAt: comment.createdAt,
      replies: [],
      reactions: aggregateReactions(comment.reactions, userIdentifier),
    }
    commentMap.set(comment.id, node)
  }

  // Second pass: build tree structure
  for (const comment of comments) {
    const node = commentMap.get(comment.id)!
    if (comment.parentId) {
      const parent = commentMap.get(comment.parentId)
      if (parent) {
        parent.replies.push(node)
      }
    } else {
      rootComments.push(node)
    }
  }

  return rootComments
}
