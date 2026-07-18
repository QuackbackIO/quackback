/**
 * Moderation domain module.
 *
 * IMPORTANT: server-only. The service touches the database directly; import it
 * from server functions / API routes only, never from client bundles.
 */
export {
  listPending,
  listPendingPosts,
  listPendingComments,
  approvePost,
  rejectPost,
  approveComment,
  rejectComment,
  type ModerationAudit,
  type PendingPostRow,
  type PendingCommentRow,
} from './moderation.service'
