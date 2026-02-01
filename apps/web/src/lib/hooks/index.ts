/**
 * Hooks barrel export
 *
 * This file exports all React hooks and re-exports from related modules.
 */

// ============================================================================
// Query Hooks (data fetching)
// ============================================================================

// Inbox queries (admin)
export { inboxKeys, useInboxPosts, usePostDetail, flattenInboxPosts } from './use-inbox-query'

// Portal queries (public)
export {
  publicPostsKeys,
  votedPostsKeys,
  postPermissionsKeys,
  usePublicPosts,
  useVotedPosts,
  usePostPermissions,
  flattenPublicPosts,
} from './use-portal-posts-query'

// Board queries
export { boardKeys, useBoards, useBoardDetail } from './use-boards-query'

// ============================================================================
// Mutation Hooks (re-exported from lib/mutations for convenience)
// ============================================================================

export {
  // Post mutations (admin)
  useUpdatePostStatus,
  useChangePostStatusId,
  useUpdatePostOwner,
  useUpdatePostTags,
  useUpdatePost,
  useVotePost,
  useCreatePost,
  // Comment mutations (admin)
  useToggleCommentReaction,
  useAddComment,
  // Portal mutations
  useVoteMutation,
  useCreatePublicPost,
  useUserEditPost,
  useUserDeletePost,
  // Board mutations
  useCreateBoard,
  useUpdateBoard,
  useDeleteBoard,
} from '@/lib/mutations'

// ============================================================================
// Event Hook System (re-exports for backwards compatibility)
// The hook system has moved to @/lib/events/.
// Prefer importing directly from '@/lib/events' in new code.
// ============================================================================

// Re-export registry functions
export { getHook, registerHook } from '@/lib/events/registry'

// Re-export types
export type {
  HookHandler,
  HookResult,
  HookTarget,
  TestResult,
  ProcessResult,
  SlackTarget,
  SlackConfig,
  EmailTarget,
  EmailConfig,
} from '@/lib/events/hook-types'

export type { NotificationTarget, NotificationConfig } from '@/lib/events/handlers/notification'
export type { WebhookTarget, WebhookConfig } from '@/lib/events/handlers/webhook'
