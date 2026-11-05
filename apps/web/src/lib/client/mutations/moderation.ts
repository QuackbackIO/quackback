import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  approvePostFn,
  rejectPostFn,
  approveCommentFn,
  rejectCommentFn,
} from '@/lib/server/functions/moderation'
import { inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { publicPostsKeys } from '@/lib/client/hooks/use-portal-posts-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { portalDetailQueries } from '@/lib/client/queries/portal-detail'
import type { PostId } from '@quackback/ids'

const pendingPostsKey = ['portal', 'moderation', 'pending', 'posts'] as const

/**
 * A moderation call that fails (most often POST_NOT_PENDING because someone
 * already decided) must say so; otherwise the button looks dead.
 */
function showModerationError(error: unknown, fallback: string) {
  toast.error(error instanceof Error && error.message ? error.message : fallback)
}

function invalidateModerationSurfaces(
  queryClient: ReturnType<typeof useQueryClient>,
  postId?: PostId
) {
  queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
  queryClient.invalidateQueries({ queryKey: publicPostsKeys.lists() })
  queryClient.invalidateQueries({ queryKey: adminQueries.boardsWithCounts().queryKey })
  queryClient.invalidateQueries({ queryKey: adminQueries.moderationStatus().queryKey })
  queryClient.invalidateQueries({ queryKey: ['admin', 'moderation'] })
  queryClient.invalidateQueries({ queryKey: pendingPostsKey })
  if (postId) {
    queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
    queryClient.invalidateQueries({ queryKey: portalDetailQueries.postDetail(postId).queryKey })
  }
}

export function useApprovePost(postId?: PostId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => approvePostFn({ data: { postId: id } }),
    onSuccess: (_data, id) => {
      toast.success('Post approved')
      invalidateModerationSurfaces(queryClient, (postId ?? id) as PostId)
    },
    onError: (error, id) => {
      showModerationError(error, 'Failed to approve post')
      invalidateModerationSurfaces(queryClient, (postId ?? id) as PostId)
    },
  })
}

export function useRejectPost(postId?: PostId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { postId: string; reason?: string }) =>
      rejectPostFn({ data: { postId: vars.postId, reason: vars.reason } }),
    onSuccess: (_data, vars) => {
      toast.success('Post rejected')
      invalidateModerationSurfaces(queryClient, (postId ?? vars.postId) as PostId)
    },
    onError: (error, vars) => {
      showModerationError(error, 'Failed to reject post')
      invalidateModerationSurfaces(queryClient, (postId ?? vars.postId) as PostId)
    },
  })
}

export function useApproveComment(postId?: PostId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => approveCommentFn({ data: { commentId } }),
    onSuccess: () => {
      toast.success('Comment approved')
      invalidateModerationSurfaces(queryClient, postId)
    },
    onError: (error) => {
      showModerationError(error, 'Failed to approve comment')
      invalidateModerationSurfaces(queryClient, postId)
    },
  })
}

export function useRejectComment(postId?: PostId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { commentId: string; reason?: string }) =>
      rejectCommentFn({ data: { commentId: vars.commentId, reason: vars.reason } }),
    onSuccess: () => {
      toast.success('Comment rejected')
      invalidateModerationSurfaces(queryClient, postId)
    },
    onError: (error) => {
      showModerationError(error, 'Failed to reject comment')
      invalidateModerationSurfaces(queryClient, postId)
    },
  })
}
