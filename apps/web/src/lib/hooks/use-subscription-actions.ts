import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSubscriptionStatus,
  subscribeToPostFn,
  unsubscribeFromPostFn,
  updateSubscriptionLevelFn,
} from '@/lib/server-functions/subscriptions'
import type { PostId } from '@quackback/ids'
import type { SubscriptionLevel } from '@/lib/subscriptions/subscription.types'

// ============================================================================
// Types
// ============================================================================

interface SubscriptionStatus {
  subscribed: boolean
  level: SubscriptionLevel
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
        const result = await fetchSubscriptionStatus({ data: { postId } })
        return {
          subscribed: result.subscribed,
          level: result.level,
          reason: result.reason,
        }
      } catch {
        return { subscribed: false, level: 'none', reason: null }
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
    mutationFn: ({
      reason = 'manual',
      level = 'all',
    }: { reason?: SubscriptionReason; level?: SubscriptionLevel } = {}) =>
      subscribeToPostFn({ data: { postId, reason, level: level === 'none' ? 'all' : level } }),
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

  const updateLevelMutation = useMutation({
    mutationFn: (level: SubscriptionLevel) =>
      updateSubscriptionLevelFn({ data: { postId, level } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
    },
  })

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isSubscribed: statusQuery.data?.subscribed ?? false,
    level: statusQuery.data?.level ?? 'none',
    subscribe: subscribeMutation.mutate,
    unsubscribe: unsubscribeMutation.mutate,
    updateLevel: updateLevelMutation.mutate,
    isPending:
      subscribeMutation.isPending || unsubscribeMutation.isPending || updateLevelMutation.isPending,
  }
}
