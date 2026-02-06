// ============================================================================
// Query Hooks
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

// Comment queries
export { commentKeys, useCommentPermissions, useCanPinComment } from './use-comments-query'

// Notification queries
export {
  notificationsKeys,
  useNotifications,
  useUnreadCount,
  type SerializedNotification,
  type NotificationsListResult,
} from './use-notifications-queries'

// User queries
export { usersKeys, usePortalUsers, useUserDetail, flattenUsers } from './use-users-queries'

// Roadmap queries
export {
  roadmapsKeys,
  useRoadmaps,
  usePublicRoadmaps,
  type RoadmapView,
} from './use-roadmaps-query'

// Settings queries
export { useWorkspaceLogo, useWorkspaceHeaderLogo } from './use-settings-queries'

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
  // Portal comment mutations
  useCreateComment,
  useEditComment,
  useDeleteComment,
  useToggleReaction,
  usePinComment,
  useUnpinComment,
  // Portal post action mutations
  usePostActions,
  // Integration mutations
  useUpdateIntegration,
  useDeleteIntegration,
  // Roadmap posts mutations
  useAddPostToRoadmap,
  useRemovePostFromRoadmap,
  // Roadmap mutations
  useCreateRoadmap,
  useUpdateRoadmap,
  useDeleteRoadmap,
  useReorderRoadmaps,
  // Notification mutations
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
  useArchiveNotification,
  // User mutations
  useRemovePortalUser,
} from '@/lib/client/mutations'
