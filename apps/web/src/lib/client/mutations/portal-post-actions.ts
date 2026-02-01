/**
 * Portal post action mutations
 *
 * Mutation hooks for portal users to edit/delete their own posts.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { PostId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'
import { userEditPostFn, userDeletePostFn } from '@/lib/server/functions/public-posts'
import { portalDetailQueries } from '@/lib/client/queries/portal-detail'
import { postPermissionsKeys } from '@/lib/client/hooks/use-portal-posts-query'

// ============================================================================
// Types
// ============================================================================

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
// Mutation Hook
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
      queryClient.invalidateQueries({ queryKey: postPermissionsKeys.detail(postId) })
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
