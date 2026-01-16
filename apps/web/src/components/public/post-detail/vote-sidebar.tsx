import { useSuspenseQuery } from '@tanstack/react-query'
import { portalDetailQueries } from '@/lib/queries/portal-detail'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { AuthSubscriptionBell } from '@/components/public/auth-subscription-bell'
import { Skeleton } from '@/components/ui/skeleton'
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
  voteCount: number
}

export function VoteSidebar({ postId, voteCount }: VoteSidebarProps) {
  // useSuspenseQuery reads from cache if available (prefetched in loader), fetches if not
  // Suspense boundary handles loading state, so no skeleton needed here
  const { data: sidebarData } = useSuspenseQuery(portalDetailQueries.voteSidebarData(postId))

  const isMember = sidebarData?.isMember ?? false
  const subscriptionStatus = sidebarData?.subscriptionStatus ?? {
    subscribed: false,
    level: 'none' as const,
    reason: null,
  }

  return (
    <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30 bg-muted/10 gap-4">
      <AuthVoteButton postId={postId} voteCount={voteCount} disabled={!isMember} />
      <AuthSubscriptionBell
        postId={postId}
        initialStatus={subscriptionStatus}
        disabled={!isMember}
      />
    </div>
  )
}
