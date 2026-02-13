/**
 * Mutation hooks barrel export
 *
 * All TanStack Query mutation hooks for the application.
 */

// Admin post mutations
export {
  useUpdatePostStatus,
  useChangePostStatusId,
  useUpdatePostOwner,
  useUpdatePostTags,
  useUpdatePost,
  useVotePost,
  useCreatePost,
  useToggleCommentsLock,
} from './posts'

// Admin comment mutations
export { useToggleCommentReaction, useAddComment } from './comments'

// Portal post mutations
export {
  useVoteMutation,
  useCreatePublicPost,
  useUserEditPost,
  useUserDeletePost,
} from './portal-posts'

// Board mutations
export { useCreateBoard, useUpdateBoard, useDeleteBoard } from './boards'

// Portal comment mutations
export {
  useCreateComment,
  useEditComment,
  useDeleteComment,
  useToggleReaction,
  usePinComment,
  useUnpinComment,
} from './portal-comments'

// Portal post action mutations
export { usePostActions, type EditPostInput } from './portal-post-actions'

// Integration mutations
export { useUpdateIntegration, useDeleteIntegration } from './integrations'

// Status sync mutations
export { useEnableStatusSync, useDisableStatusSync, useUpdateStatusMappings } from './status-sync'

// Platform credential mutations
export { useSavePlatformCredentials, useDeletePlatformCredentials } from './platform-credentials'

// Auth provider credential mutations
export {
  useSaveAuthProviderCredentials,
  useDeleteAuthProviderCredentials,
} from './auth-provider-credentials'

// Roadmap posts mutations
export { useAddPostToRoadmap, useRemovePostFromRoadmap } from './roadmap-posts'

// Roadmap mutations
export {
  useCreateRoadmap,
  useUpdateRoadmap,
  useDeleteRoadmap,
  useReorderRoadmaps,
} from './roadmaps'

// Notification mutations
export {
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
  useArchiveNotification,
} from './notifications'

// User mutations
export { useRemovePortalUser } from './users'
