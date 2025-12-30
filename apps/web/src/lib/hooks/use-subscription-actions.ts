'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getSubscriptionStatusAction,
  subscribeToPostAction,
  unsubscribeFromPostAction,
  muteSubscriptionAction,
  type SubscriptionStatus,
} from '@/lib/actions/subscriptions'
import type { ActionError } from '@/lib/actions/types'
import type { PostId } from '@quackback/ids'

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
      const result = await getSubscriptionStatusAction({ data: { postId } })
      if (!result.success) {
        // Return default status on error (user not subscribed)
        return { subscribed: false, muted: false, reason: null }
      }
      return result.data
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
  onError?: (error: ActionError) => void
}

/**
 * Hook to subscribe to a post.
 */
export function useSubscribe({ postId, onSuccess, onError }: UseSubscribeOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (reason: 'manual' | 'author' | 'vote' | 'comment' = 'manual') => {
      const result = await subscribeToPostAction({ data: { postId, reason } })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      // Update the subscription status in cache
      queryClient.setQueryData(subscriptionKeys.status(postId), data)
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}

interface UseUnsubscribeOptions {
  postId: PostId
  onSuccess?: (status: SubscriptionStatus) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to unsubscribe from a post.
 */
export function useUnsubscribe({ postId, onSuccess, onError }: UseUnsubscribeOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const result = await unsubscribeFromPostAction({ data: { postId } })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      // Update the subscription status in cache
      queryClient.setQueryData(subscriptionKeys.status(postId), data)
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
      onError?.(error)
    },
  })
}

interface UseMuteSubscriptionOptions {
  postId: PostId
  onSuccess?: (status: SubscriptionStatus) => void
  onError?: (error: ActionError) => void
}

/**
 * Hook to mute/unmute a subscription.
 */
export function useMuteSubscription({ postId, onSuccess, onError }: UseMuteSubscriptionOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (muted: boolean) => {
      const result = await muteSubscriptionAction({ data: { postId, muted } })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      // Update the subscription status in cache
      queryClient.setQueryData(subscriptionKeys.status(postId), data)
      onSuccess?.(data)
    },
    onError: (error: ActionError) => {
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
      const result = await subscribeToPostAction({ data: { postId, reason } })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(subscriptionKeys.status(postId), data)
    },
  })

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      const result = await unsubscribeFromPostAction({ data: { postId } })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(subscriptionKeys.status(postId), data)
    },
  })

  const muteMutation = useMutation({
    mutationFn: async (muted: boolean) => {
      const result = await muteSubscriptionAction({ data: { postId, muted } })
      if (!result.success) {
        throw result.error
      }
      return result.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(subscriptionKeys.status(postId), data)
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
