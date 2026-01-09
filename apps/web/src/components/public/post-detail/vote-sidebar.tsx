import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getVoteSidebarDataFn } from '@/lib/server-functions/public-posts'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { AuthSubscriptionBell } from '@/components/public/auth-subscription-bell'
import { Skeleton } from '@/components/ui/skeleton'
import { votedPostsKeys } from '@/lib/hooks/use-public-posts-query'
import type { PostId } from '@quackback/ids'

export function VoteSidebarSkeleton() {
  return (
    <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30 bg-muted/10 gap-4">
      <Skeleton className="h-16 w-12 rounded-xl" />
      <Skeleton className="h-9 w-9 rounded-full" />
    </div>
  )
}

interface VoteSidebarProps {
  postId: PostId
  initialVoteCount: number
}

export function VoteSidebar({ postId, initialVoteCount }: VoteSidebarProps) {
  const queryClient = useQueryClient()

  // Get hasVoted from the shared votedPosts cache (single source of truth)
  const { data: votedPosts } = useQuery<Set<string>>({
    queryKey: votedPostsKeys.byWorkspace(),
  })

  // Get membership and subscription data separately
  const { data: sidebarData, isLoading } = useQuery({
    queryKey: ['vote-sidebar', postId],
    queryFn: () => getVoteSidebarDataFn({ data: { postId } }),
  })

  // Sync sidebar data to the shared votedPosts cache on initial load
  // This ensures the cache is populated when navigating directly to detail page
  useEffect(() => {
    if (sidebarData?.hasVoted !== undefined) {
      queryClient.setQueryData<Set<string>>(votedPostsKeys.byWorkspace(), (old) => {
        const next = new Set(old || [])
        if (sidebarData.hasVoted) {
          next.add(postId)
        } else {
          next.delete(postId)
        }
        return next
      })
    }
  }, [sidebarData?.hasVoted, postId, queryClient])

  // Read from the shared cache (may be updated by the effect above)
  const hasVoted = votedPosts?.has(postId) ?? sidebarData?.hasVoted ?? false

  if (isLoading || !sidebarData) {
    return <VoteSidebarSkeleton />
  }

  return (
    <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30 bg-muted/10 gap-4">
      <AuthVoteButton
        postId={postId}
        initialVoteCount={initialVoteCount}
        initialHasVoted={hasVoted}
        disabled={!sidebarData.isMember}
      />
      <AuthSubscriptionBell
        postId={postId}
        initialStatus={sidebarData.subscriptionStatus}
        disabled={!sidebarData.isMember}
      />
    </div>
  )
}
