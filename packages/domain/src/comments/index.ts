/**
 * Comment domain module exports
 */

export { CommentService, commentService } from './comment.service'
export { CommentError } from './comment.errors'
export type { CommentErrorCode } from './comment.errors'
export type {
  CreateCommentInput,
  UpdateCommentInput,
  CommentThread,
  CommentReactionCount,
  ReactionResult,
} from './comment.types'
