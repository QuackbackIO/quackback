/**
 * Admin subscription mutations
 *
 * Mutation hooks for admin-level subscription management (e.g. changing a voter's notification level).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PostId, PrincipalId } from '@quackback/ids'
import type { SubscriptionLevel } from '@/lib/server/domains/subscriptions/subscription.types'
import { adminUpdateVoterSubscriptionFn } from '@/lib/server/functions/subscriptions'

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
    },
  })
}
