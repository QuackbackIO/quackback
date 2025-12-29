/**
 * Comment domain module exports
 */

export {
  createComment,
  updateComment,
  deleteComment,
  getCommentById,
  getCommentsByPost,
  addReaction,
  removeReaction,
  toggleReaction,
  canEditComment,
  canDeleteComment,
  userEditComment,
  softDeleteComment,
} from './comment.service'
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
