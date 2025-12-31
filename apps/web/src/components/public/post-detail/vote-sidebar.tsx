import { useQuery } from '@tanstack/react-query'
import { getVoteSidebarDataFn } from '@/lib/server-functions/public-posts'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { AuthSubscriptionBell } from '@/components/public/auth-subscription-bell'
import { Skeleton } from '@/components/ui/skeleton'
import type { PostId } from '@quackback/ids'

export function VoteSidebarSkeleton() {
  return (
    <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30 gap-4">
      <div className="flex flex-col items-center gap-1">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="h-4 w-6" />
      </div>
      <Skeleton className="h-8 w-8 rounded-full" />
    </div>
  )
}

interface VoteSidebarProps {
  postId: PostId
  initialVoteCount: number
}

export function VoteSidebar({ postId, initialVoteCount }: VoteSidebarProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['vote-sidebar', postId],
    queryFn: () => getVoteSidebarDataFn({ data: { postId } }),
  })

  if (isLoading || !data) {
    return <VoteSidebarSkeleton />
  }

  return (
    <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30 gap-4">
      <AuthVoteButton
        postId={postId}
        initialVoteCount={initialVoteCount}
        initialHasVoted={data.hasVoted}
        disabled={!data.isMember}
      />
      <AuthSubscriptionBell
        postId={postId}
        initialStatus={data.subscriptionStatus}
        disabled={!data.isMember}
      />
    </div>
  )
}
