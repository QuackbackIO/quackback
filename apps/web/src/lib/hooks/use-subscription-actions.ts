import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSubscriptionStatus,
  subscribeToPostFn,
  unsubscribeFromPostFn,
  muteSubscriptionFn,
} from '@/lib/server-functions/subscriptions'
import type { PostId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

interface SubscriptionStatus {
  subscribed: boolean
  muted: boolean
  reason: string | null
}

type SubscriptionReason = 'manual' | 'author' | 'vote' | 'comment'

interface UseSubscriptionStatusOptions {
  postId: PostId
  enabled?: boolean
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const subscriptionKeys = {
  all: ['subscriptions'] as const,
  status: (postId: PostId) => [...subscriptionKeys.all, 'status', postId] as const,
}

// ============================================================================
// Query Hook
// ============================================================================

/**
 * Hook to get the current user's subscription status for a post.
 */
export function useSubscriptionStatus({ postId, enabled = true }: UseSubscriptionStatusOptions) {
  return useQuery({
    queryKey: subscriptionKeys.status(postId),
    queryFn: async (): Promise<SubscriptionStatus> => {
      try {
        return await fetchSubscriptionStatus({ data: { postId } })
      } catch {
        return { subscribed: false, muted: false, reason: null }
      }
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  })
}

// ============================================================================
// Combined Hook
// ============================================================================

/**
 * Combined hook for all subscription actions.
 * Provides status, mutations, and derived state in a single interface.
 */
export function usePostSubscription({ postId, enabled = true }: UseSubscriptionStatusOptions) {
  const queryClient = useQueryClient()
  const statusQuery = useSubscriptionStatus({ postId, enabled })

  const subscribeMutation = useMutation({
    mutationFn: (reason: SubscriptionReason = 'manual') =>
      subscribeToPostFn({ data: { postId, reason } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
    },
  })

  const unsubscribeMutation = useMutation({
    mutationFn: () => unsubscribeFromPostFn({ data: { postId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
    },
  })

  const muteMutation = useMutation({
    mutationFn: (muted: boolean) => muteSubscriptionFn({ data: { postId, muted } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
    },
  })

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isSubscribed: statusQuery.data?.subscribed ?? false,
    isMuted: statusQuery.data?.muted ?? false,
    subscribe: subscribeMutation.mutate,
    unsubscribe: unsubscribeMutation.mutate,
    toggleMute: () => muteMutation.mutate(!statusQuery.data?.muted),
    isPending:
      subscribeMutation.isPending || unsubscribeMutation.isPending || muteMutation.isPending,
  }
}
