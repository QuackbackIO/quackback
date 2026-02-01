/**
 * Centralized type exports for the lib layer.
 *
 * Import types from here to avoid circular dependencies:
 *   import type { InboxFilters, PostDetails } from '@/lib/shared/types'
 *
 * Types are organized by domain:
 * - filters.ts: Filter types for list views (inbox, portal, users)
 * - inbox.ts: Admin inbox post detail types
 */

// Filter types
export type { InboxFilters, PublicFeedbackFilters, UsersFilters } from './filters'

// Inbox/post detail types
export type {
  OfficialResponse,
  PinnedComment,
  CommentReaction,
  CommentWithReplies,
  PostDetails,
  CurrentUser,
} from './inbox'
