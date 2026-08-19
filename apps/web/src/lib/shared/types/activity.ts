/**
 * Activity-related types for client use.
 *
 * ActivityType is defined directly here (it is a pure string union with no
 * runtime deps) because its source lives in activity.service.ts which imports
 * from @/lib/server/db, making a re-export unsafe.
 */

export type ActivityType =
  | 'post.created'
  | 'post.deleted'
  | 'post.restored'
  | 'status.changed'
  | 'post.board_changed'
  | 'post.merged_in'
  | 'post.merged_away'
  | 'post.unmerged'
  | 'vote.proxy'
  | 'vote.removed'
  | 'owner.assigned'
  | 'owner.unassigned'
  | 'tags.added'
  | 'tags.removed'
  | 'comments.locked'
  | 'comments.unlocked'
  | 'comment.pinned'
  | 'comment.unpinned'
  | 'comment.deleted'
  | 'comment.removed'
  | 'comment.restored'
  | 'external.status_changed'
