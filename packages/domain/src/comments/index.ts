/**
 * Comment domain module exports
 */

export { CommentService, commentService } from './comment.service'
export { CommentError } from './comment.errors'
export type { CommentErrorCode } from './comment.errors'
export type {
  CreateCommentInput,
  CreateCommentResult,
  UpdateCommentInput,
  CommentThread,
  CommentReactionCount,
  ReactionResult,
  CommentContext,
} from './comment.types'
