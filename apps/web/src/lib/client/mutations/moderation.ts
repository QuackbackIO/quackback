import { useMutation, useQueryClient } from '@tanstack/react-query'
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
    onSuccess: (_data, id) => invalidateModerationSurfaces(queryClient, (postId ?? id) as PostId),
  })
}

export function useRejectPost(postId?: PostId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { postId: string; reason?: string }) =>
      rejectPostFn({ data: { postId: vars.postId, reason: vars.reason } }),
    onSuccess: (_data, vars) =>
      invalidateModerationSurfaces(queryClient, (postId ?? vars.postId) as PostId),
  })
}

export function useApproveComment(postId?: PostId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => approveCommentFn({ data: { commentId } }),
    onSuccess: () => invalidateModerationSurfaces(queryClient, postId),
  })
}

export function useRejectComment(postId?: PostId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { commentId: string; reason?: string }) =>
      rejectCommentFn({ data: { commentId: vars.commentId, reason: vars.reason } }),
    onSuccess: () => invalidateModerationSurfaces(queryClient, postId),
  })
}
