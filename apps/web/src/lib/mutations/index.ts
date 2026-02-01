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
