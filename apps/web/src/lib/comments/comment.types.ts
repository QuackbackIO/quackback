/**
 * Input/Output types for CommentService operations
 */

import type { PostId, CommentId, BoardId, MemberId } from '@quackback/ids'

/**
 * Input for creating a new comment
 */
export interface CreateCommentInput {
  postId: PostId
  content: string
  parentId?: CommentId | null
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
 * Result of creating a comment, including post info for event building
 */
export interface CreateCommentResult {
  comment: {
    id: CommentId
    postId: PostId
    content: string
    parentId: CommentId | null
    memberId: MemberId | null
    authorName: string | null
    authorEmail: string | null
    isTeamMember: boolean
    createdAt: Date
  }
  post: {
    id: PostId
    title: string
  }
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

/**
 * Full context of a comment including its post and board
 * Used by public API routes that need to check permissions
 */
export interface CommentContext {
  comment: {
    id: CommentId
    postId: PostId
    content: string
    parentId: CommentId | null
    memberId: MemberId | null
    authorName: string | null
    createdAt: Date
  }
  post: {
    id: PostId
    boardId: BoardId
    title: string
  }
  board: {
    id: BoardId
    name: string
    slug: string
  }
}

/**
 * Result of checking edit/delete permission
 */
export interface CommentPermissionCheckResult {
  allowed: boolean
  reason?: string
}
