/**
 * Input/Output types for CommentService operations
 */

import type { PostId, CommentId, BoardId, PrincipalId, StatusId } from '@quackback/ids'
import type { CommentStatusChange } from '@/lib/shared'

/**
 * Input for creating a new comment
 */
export interface CreateCommentInput {
  postId: PostId
  content: string
  parentId?: CommentId | null
  /** Optional status change to apply atomically with the comment */
  statusId?: StatusId | null
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
    principalId: PrincipalId
    isTeamMember: boolean
    createdAt: Date
    statusChangeFromId: StatusId | null
    statusChangeToId: StatusId | null
  }
  post: {
    id: PostId
    title: string
    boardSlug: string
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
  principalId: PrincipalId
  authorName: string | null
  content: string
  isTeamMember: boolean
  createdAt: Date
  avatarUrl?: string | null
  statusChange?: CommentStatusChange | null
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
    principalId: PrincipalId
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
