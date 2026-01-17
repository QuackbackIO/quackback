import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { PostId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'
import {
  getPostPermissionsFn,
  userEditPostFn,
  userDeletePostFn,
} from '@/lib/server-functions/public-posts'
import { portalDetailQueries } from '@/lib/queries/portal-detail'

// ============================================================================
// Types
// ============================================================================

interface PostPermissions {
  canEdit: boolean
  canDelete: boolean
  editReason?: string
  deleteReason?: string
}

export interface EditPostInput {
  title: string
  content: string
  contentJson?: JSONContent
}

interface UsePostActionsOptions {
  postId: PostId
  boardSlug: string
  onEditSuccess?: () => void
  onDeleteSuccess?: () => void
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const postActionKeys = {
  all: ['post-actions'] as const,
  permissions: () => [...postActionKeys.all, 'permissions'] as const,
  permission: (postId: PostId) => [...postActionKeys.permissions(), postId] as const,
}

// ============================================================================
// Query Hook
// ============================================================================

/**
 * Hook to get edit/delete permissions for a post.
 */
export function usePostPermissions({
  postId,
  enabled = true,
}: {
  postId: PostId
  enabled?: boolean
}) {
  return useQuery({
    queryKey: postActionKeys.permission(postId),
    queryFn: async (): Promise<PostPermissions> => {
      try {
        return await getPostPermissionsFn({ data: { postId } })
      } catch {
        return { canEdit: false, canDelete: false }
      }
    },
    enabled,
    staleTime: 30 * 1000, // 30s
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Hook for handling post edit and delete mutations.
 */
export function usePostActions({
  postId,
  boardSlug,
  onEditSuccess,
  onDeleteSuccess,
}: UsePostActionsOptions) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const editMutation = useMutation({
    mutationFn: (input: EditPostInput) =>
      userEditPostFn({
        data: {
          postId,
          title: input.title,
          content: input.content,
          contentJson: input.contentJson as { type: 'doc'; content?: unknown[] },
        },
      }),
    onSuccess: () => {
      // Invalidate post detail to refresh with updated content
      queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
      // Invalidate permissions in case edit window expired
      queryClient.invalidateQueries({ queryKey: postActionKeys.permission(postId) })
      onEditSuccess?.()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => userDeletePostFn({ data: { postId } }),
    onSuccess: () => {
      // Invalidate post lists
      queryClient.invalidateQueries({ queryKey: ['portal', 'posts'] })
      // Navigate back to board
      navigate({ to: '/', search: { board: boardSlug } })
      onDeleteSuccess?.()
    },
  })

  return {
    editPost: editMutation.mutate,
    deletePost: deleteMutation.mutate,
    isEditing: editMutation.isPending,
    isDeleting: deleteMutation.isPending,
    editError: editMutation.error,
    deleteError: deleteMutation.error,
  }
}
