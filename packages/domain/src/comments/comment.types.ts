/**
 * Input/Output types for CommentService operations
 */

/**
 * Input for creating a new comment
 */
export interface CreateCommentInput {
  postId: string
  content: string
  parentId?: string | null
  authorName?: string | null
  authorEmail?: string | null
}

/**
 * Input for updating an existing comment
 */
export interface UpdateCommentInput {
  content?: string
}

/**
 * Reaction count with user status
 */
export interface CommentReactionCount {
  emoji: string
  count: number
  hasReacted: boolean
}

/**
 * Comment with nested replies (threaded structure)
 */
export interface CommentThread {
  id: string
  postId: string
  parentId: string | null
  memberId: string | null
  authorId: string | null
  authorName: string | null
  authorEmail: string | null
  content: string
  isTeamMember: boolean
  createdAt: Date
  replies: CommentThread[]
  reactions: CommentReactionCount[]
}

/**
 * Result of a reaction operation
 */
export interface ReactionResult {
  /** Whether the reaction was added (true) or removed (false) */
  added: boolean
  /** Updated reaction counts */
  reactions: CommentReactionCount[]
}
