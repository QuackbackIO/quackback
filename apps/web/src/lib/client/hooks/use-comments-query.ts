/**
 * Comment query hooks
 *
 * Query hooks for fetching comment permissions.
 * Mutations are in @/lib/client/mutations/portal-comments.
 */

import { useQuery } from '@tanstack/react-query'
import { getCommentPermissionsFn, canPinCommentFn } from '@/lib/server/functions/comments'
import type { PostCommentId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

interface CommentPermissions {
  canEdit: boolean
  canDelete: boolean
  editReason?: string
  deleteReason?: string
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const commentKeys = {
  all: ['comments'] as const,
  permissions: () => [...commentKeys.all, 'permissions'] as const,
  permission: (commentId: PostCommentId) => [...commentKeys.permissions(), commentId] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Hook to get edit/delete permissions for a comment.
 */
export function useCommentPermissions({
  commentId,
  enabled = true,
}: {
  commentId: PostCommentId
  enabled?: boolean
}) {
  return useQuery({
    queryKey: commentKeys.permission(commentId),
    queryFn: async (): Promise<CommentPermissions> => {
      try {
        return await getCommentPermissionsFn({ data: { commentId } })
      } catch {
        return { canEdit: false, canDelete: false }
      }
    },
    enabled,
    staleTime: 30 * 1000,
  })
}

/**
 * Hook to check if a comment can be pinned as the official response.
 */
export function useCanPinComment({
  commentId,
  enabled = true,
}: {
  commentId: PostCommentId
  enabled?: boolean
}) {
  return useQuery({
    queryKey: [...commentKeys.all, 'canPin', commentId],
    queryFn: async () => {
      try {
        return await canPinCommentFn({ data: { commentId } })
      } catch {
        return { canPin: false, reason: 'An error occurred' }
      }
    },
    enabled,
    staleTime: 30 * 1000,
  })
}
