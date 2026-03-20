/**
 * Widget-specific vote hook that injects Bearer auth headers.
 *
 * The portal's usePostVote uses toggleVoteFn which relies on session cookies.
 * In the widget iframe (cross-origin), cookies can't be set, so we inject
 * Authorization: Bearer headers via the server function's headers option.
 */

import { useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toggleVoteFn, getVotedPostsFn } from '@/lib/server/functions/public-posts'
import { getWidgetAuthHeaders, hasWidgetToken } from '@/lib/client/widget-auth'
import { voteCountKeys } from './use-post-vote'
import type { PostId } from '@quackback/ids'

/** Initial sessionVersion before any identify() call */
export const INITIAL_SESSION_VERSION = 0

// Query keys for widget queries
export const widgetQueryKeys = {
  votedPosts: {
    all: ['widget', 'votedPosts'] as const,
    bySession: (version: number) => ['widget', 'votedPosts', version] as const,
  },
  postDetail: {
    all: ['widget', 'post'] as const,
    byId: (postId: string, version: number) => ['widget', 'post', postId, version] as const,
  },
}

interface UseWidgetVoteOptions {
  postId: PostId
  voteCount: number
  /** Session version from WidgetAuthProvider — triggers refetch after identify */
  sessionVersion?: number
  enabled?: boolean
}

export function useWidgetVote({ postId, voteCount, sessionVersion = 0, enabled = true }: UseWidgetVoteOptions) {
  const queryClient = useQueryClient()
  // Ref tracks latest sessionVersion so mutation callbacks always write to the
  // current cache key, even if ensureSession() bumped the version mid-render.
  const sessionVersionRef = useRef(sessionVersion)
  sessionVersionRef.current = sessionVersion

  const { data: cachedVoteCount } = useQuery({
    queryKey: voteCountKeys.byPost(postId),
    queryFn: () => voteCount,
    ...(enabled && { initialData: voteCount }),
    staleTime: Infinity,
    enabled,
  })

  // Include sessionVersion in the key so this refetches after identify.
  // Don't fetch until a token exists — avoids caching an empty set pre-auth.
  const hasToken = hasWidgetToken()
  const { data: votedPosts } = useQuery<Set<string>>({
    queryKey: widgetQueryKeys.votedPosts.bySession(sessionVersion),
    queryFn: async () => {
      const headers = getWidgetAuthHeaders()
      if (!headers.Authorization) return new Set<string>()
      const result = await getVotedPostsFn({ headers })
      return new Set(result.votedPostIds)
    },
    staleTime: 5 * 60 * 1000,
    enabled: enabled && hasToken,
  })

  const hasVoted = votedPosts?.has(postId) ?? false

  const voteMutation = useMutation({
    mutationFn: (id: PostId) =>
      toggleVoteFn({ data: { postId: id }, headers: getWidgetAuthHeaders() }),
    onMutate: async (id) => {
      const previouslyVoted = votedPosts?.has(id) ?? false
      const key = widgetQueryKeys.votedPosts.bySession(sessionVersionRef.current)

      // Optimistic: update votedPosts
      queryClient.setQueryData<Set<string>>(key, (old) => {
        const next = new Set(old || [])
        if (!previouslyVoted) next.add(id)
        else next.delete(id)
        return next
      })

      return { previouslyVoted }
    },
    onError: (_err, id, context) => {
      const key = widgetQueryKeys.votedPosts.bySession(sessionVersionRef.current)
      queryClient.setQueryData<Set<string>>(key, (old) => {
        const next = new Set(old || [])
        if (context?.previouslyVoted) next.add(id)
        else next.delete(id)
        return next
      })
    },
    onSuccess: (data, id) => {
      const key = widgetQueryKeys.votedPosts.bySession(sessionVersionRef.current)
      queryClient.setQueryData<number>(voteCountKeys.byPost(id), data.voteCount)
      queryClient.setQueryData<Set<string>>(key, (old) => {
        const next = new Set(old || [])
        if (data.voted) next.add(id)
        else next.delete(id)
        return next
      })
      window.parent.postMessage(
        {
          type: 'quackback:event',
          name: 'vote',
          payload: { postId: id, voted: data.voted, voteCount: data.voteCount },
        },
        '*'
      )
    },
  })

  function handleVote(e?: React.MouseEvent): void {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    const newVoted = !hasVoted

    // Optimistic update for vote count
    queryClient.setQueryData<number>(
      voteCountKeys.byPost(postId),
      (old) => (old ?? voteCount) + (newVoted ? 1 : -1)
    )

    voteMutation.mutate(postId, {
      onError: () => {
        queryClient.setQueryData<number>(
          voteCountKeys.byPost(postId),
          (old) => (old ?? voteCount) + (newVoted ? -1 : 1)
        )
      },
      onSuccess: (data) => {
        queryClient.setQueryData<number>(voteCountKeys.byPost(postId), data.voteCount)
      },
    })
  }

  return {
    voteCount: cachedVoteCount ?? voteCount,
    hasVoted,
    isPending: voteMutation.isPending,
    handleVote,
  }
}
