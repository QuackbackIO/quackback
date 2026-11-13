/**
 * Admin subscription mutations
 *
 * Mutation hooks for admin-level subscription management: changing a voter's
 * notification level, and adding or removing a post's subscribers.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PostId, PrincipalId } from '@quackback/ids'
import type { SubscriptionLevel } from '@/lib/shared/types'
import { adminUpdateVoterSubscriptionFn } from '@/lib/server/functions/subscriptions'
import {
  addPostSubscriberFn,
  removePostSubscriberFn,
} from '@/lib/server/functions/post-subscribers'

export function useUpdateVoterSubscription(postId: PostId) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { principalId: PrincipalId; level: SubscriptionLevel }) =>
      adminUpdateVoterSubscriptionFn({
        data: { postId, principalId: input.principalId, level: input.level },
      }),
    onMutate: async ({ principalId, level }) => {
      const queryKey = ['inbox', 'voters', postId]
      await queryClient.cancelQueries({ queryKey })

      const previous =
        queryClient.getQueryData<
          Array<{ principalId: string; subscriptionLevel: SubscriptionLevel }>
        >(queryKey)

      queryClient.setQueryData(
        queryKey,
        (old: Array<{ principalId: string; subscriptionLevel: SubscriptionLevel }> | undefined) =>
          old?.map((v) => (v.principalId === principalId ? { ...v, subscriptionLevel: level } : v))
      )

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['inbox', 'voters', postId], context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox', 'voters', postId] })
      queryClient.invalidateQueries({ queryKey: ['inbox', 'subscribers', postId] })
    },
  })
}

/** Refresh everything that shows who follows a post after a subscriber change. */
function invalidateSubscriberViews(queryClient: ReturnType<typeof useQueryClient>, postId: PostId) {
  void queryClient.invalidateQueries({ queryKey: ['inbox', 'subscribers', postId] })
  // A voter's row shows their subscription level.
  void queryClient.invalidateQueries({ queryKey: ['inbox', 'voters', postId] })
  void queryClient.invalidateQueries({ queryKey: ['activity', 'post', postId] })
}

export function useAddPostSubscriber(postId: PostId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (principalId: PrincipalId) =>
      addPostSubscriberFn({ data: { postId, principalId } }),
    onSettled: () => invalidateSubscriberViews(queryClient, postId),
  })
}

export function useRemovePostSubscriber(postId: PostId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (principalId: PrincipalId) =>
      removePostSubscriberFn({ data: { postId, principalId } }),
    onSettled: () => invalidateSubscriberViews(queryClient, postId),
  })
}
