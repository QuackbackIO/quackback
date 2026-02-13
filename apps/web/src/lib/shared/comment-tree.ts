/**
 * Comment tree building utilities
 *
 * Pure functions for transforming flat comment data into nested tree structures.
 * Used by both PostService and CommentService.
 */

/**
 * Reaction count with user status
 */
export interface CommentReactionCount {
  emoji: string
  count: number
  hasReacted: boolean
}

/**
 * Status change recorded with a comment
 */
export interface CommentStatusChange {
  fromName: string
  fromColor: string
  toName: string
  toColor: string
}

/**
 * Build a CommentStatusChange from optional from/to status relations.
 * Returns null if either relation is missing.
 */
export function toStatusChange(
  from: { name: string; color: string } | null | undefined,
  to: { name: string; color: string } | null | undefined
): CommentStatusChange | null {
  if (!from || !to) return null
  return {
    fromName: from.name,
    fromColor: from.color,
    toName: to.name,
    toColor: to.color,
  }
}

/**
 * Raw comment data with reactions from database query
 */
export interface CommentWithReactions {
  id: string
  postId: string
  parentId: string | null
  principalId: string
  authorName: string | null
  content: string
  isTeamMember: boolean
  createdAt: Date
  avatarUrl?: string | null
  statusChange?: CommentStatusChange | null
  reactions: Array<{
    emoji: string
    principalId: string
  }>
}

/**
 * Comment node with nested replies and aggregated reactions
 */
export interface CommentTreeNode {
  id: string
  postId: string
  parentId: string | null
  principalId: string
  authorName: string | null
  content: string
  isTeamMember: boolean
  createdAt: Date
  avatarUrl?: string | null
  statusChange?: CommentStatusChange | null
  replies: CommentTreeNode[]
  reactions: CommentReactionCount[]
}

/**
 * Aggregate reactions by emoji, tracking whether the current user has reacted.
 *
 * @param reactions - Array of reaction records
 * @param principalId - Optional principal ID to check for current user's reactions
 * @returns Array of aggregated reaction counts
 */
export function aggregateReactions(
  reactions: Array<{ emoji: string; principalId: string }>,
  principalId?: string
): CommentReactionCount[] {
  const reactionCounts = new Map<string, { count: number; hasReacted: boolean }>()

  for (const reaction of reactions) {
    const existing = reactionCounts.get(reaction.emoji) || { count: 0, hasReacted: false }
    existing.count++
    if (principalId && reaction.principalId === principalId) {
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
 * @param principalId - Optional principal ID for reaction status
 * @returns Array of root comments with nested replies
 */
export function buildCommentTree<T extends CommentWithReactions>(
  comments: T[],
  principalId?: string
): CommentTreeNode[] {
  const commentMap = new Map<string, CommentTreeNode>()
  const rootComments: CommentTreeNode[] = []

  // First pass: create all nodes with aggregated reactions
  for (const comment of comments) {
    const node: CommentTreeNode = {
      id: comment.id,
      postId: comment.postId,
      parentId: comment.parentId,
      principalId: comment.principalId,
      authorName: comment.authorName,
      content: comment.content,
      isTeamMember: comment.isTeamMember,
      createdAt: comment.createdAt,
      avatarUrl: comment.avatarUrl,
      statusChange: comment.statusChange,
      replies: [],
      reactions: aggregateReactions(comment.reactions, principalId),
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
