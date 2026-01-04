import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSubscriptionStatus,
  subscribeToPostFn,
  unsubscribeFromPostFn,
  muteSubscriptionFn,
} from '@/lib/server-functions/subscriptions'
import type { PostId } from '@quackback/ids'

type SubscriptionStatus = {
  subscribed: boolean
  muted: boolean
  reason: string | null
}

// ============================================================================
// Query Key Factory
// ============================================================================

export const subscriptionKeys = {
  all: ['subscriptions'] as const,
  status: (postId: PostId) => [...subscriptionKeys.all, 'status', postId] as const,
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseSubscriptionStatusOptions {
  postId: PostId
  enabled?: boolean
}

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
        // Return default status on error (user not subscribed)
        return { subscribed: false, muted: false, reason: null }
      }
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  })
}

// ============================================================================
// Mutation Hooks
// ============================================================================

interface UseSubscribeOptions {
  postId: PostId
  onSuccess?: (status: SubscriptionStatus) => void
  onError?: (error: Error) => void
}

/**
 * Hook to subscribe to a post.
 */
export function useSubscribe({ postId, onSuccess, onError }: UseSubscribeOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (reason: 'manual' | 'author' | 'vote' | 'comment' = 'manual') => {
      return await subscribeToPostFn({ data: { postId, reason } })
    },
    onSuccess: async () => {
      // Refetch the subscription status
      await queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
      const newStatus = queryClient.getQueryData<SubscriptionStatus>(
        subscriptionKeys.status(postId)
      )
      if (newStatus) {
        onSuccess?.(newStatus)
      }
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}

interface UseUnsubscribeOptions {
  postId: PostId
  onSuccess?: (status: SubscriptionStatus) => void
  onError?: (error: Error) => void
}

/**
 * Hook to unsubscribe from a post.
 */
export function useUnsubscribe({ postId, onSuccess, onError }: UseUnsubscribeOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return await unsubscribeFromPostFn({ data: { postId } })
    },
    onSuccess: async () => {
      // Refetch the subscription status
      await queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
      const newStatus = queryClient.getQueryData<SubscriptionStatus>(
        subscriptionKeys.status(postId)
      )
      if (newStatus) {
        onSuccess?.(newStatus)
      }
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}

interface UseMuteSubscriptionOptions {
  postId: PostId
  onSuccess?: (status: SubscriptionStatus) => void
  onError?: (error: Error) => void
}

/**
 * Hook to mute/unmute a subscription.
 */
export function useMuteSubscription({ postId, onSuccess, onError }: UseMuteSubscriptionOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (muted: boolean) => {
      return await muteSubscriptionFn({ data: { postId, muted } })
    },
    onSuccess: async () => {
      // Refetch the subscription status
      await queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
      const newStatus = queryClient.getQueryData<SubscriptionStatus>(
        subscriptionKeys.status(postId)
      )
      if (newStatus) {
        onSuccess?.(newStatus)
      }
    },
    onError: (error: Error) => {
      onError?.(error)
    },
  })
}

/**
 * Combined hook for all subscription actions.
 */
export function usePostSubscription({ postId, enabled = true }: UseSubscriptionStatusOptions) {
  const queryClient = useQueryClient()
  const statusQuery = useSubscriptionStatus({ postId, enabled })

  const subscribeMutation = useMutation({
    mutationFn: async (reason: 'manual' | 'author' | 'vote' | 'comment' = 'manual') => {
      return await subscribeToPostFn({ data: { postId, reason } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
    },
  })

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      return await unsubscribeFromPostFn({ data: { postId } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
    },
  })

  const muteMutation = useMutation({
    mutationFn: async (muted: boolean) => {
      return await muteSubscriptionFn({ data: { postId, muted } })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: subscriptionKeys.status(postId) })
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
