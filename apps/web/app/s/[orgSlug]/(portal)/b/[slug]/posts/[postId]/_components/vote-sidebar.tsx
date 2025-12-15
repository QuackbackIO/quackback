import { db, member, eq, and } from '@quackback/db'
import { getPostService } from '@/lib/services'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { getSession } from '@/lib/auth/server'
import { SubscriptionService } from '@quackback/domain/subscriptions'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { AuthSubscriptionBell } from '@/components/public/auth-subscription-bell'
import { Skeleton } from '@/components/ui/skeleton'
import type { PostId, MemberId, OrgId } from '@quackback/ids'

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
  organizationId: OrgId
  initialVoteCount: number
}

export async function VoteSidebar({ postId, organizationId, initialVoteCount }: VoteSidebarProps) {
  const session = await getSession()

  let userIdentifier = ''
  let isMember = false
  let memberRecord: { id: string } | undefined

  if (session?.user) {
    memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)),
      columns: { id: true },
    })
    if (memberRecord) {
      userIdentifier = getMemberIdentifier(memberRecord.id)
      isMember = true
    }
  }

  // Check if user has voted
  let hasVoted = false
  if (userIdentifier) {
    const voteResult = await getPostService().hasUserVotedOnPost(postId, userIdentifier)
    hasVoted = voteResult.success ? voteResult.value : false
  }

  // Check subscription status
  let subscriptionStatus: { subscribed: boolean; muted: boolean; reason: string | null } = {
    subscribed: false,
    muted: false,
    reason: null,
  }
  if (isMember && memberRecord) {
    const subscriptionService = new SubscriptionService()
    const memberId = memberRecord.id as MemberId
    subscriptionStatus = await subscriptionService.getSubscriptionStatus(
      memberId,
      postId,
      organizationId
    )
  }

  return (
    <div className="flex flex-col items-center justify-start py-6 px-4 border-r border-border/30 gap-4">
      <AuthVoteButton
        postId={postId}
        initialVoteCount={initialVoteCount}
        initialHasVoted={hasVoted}
        disabled={!isMember}
      />
      <AuthSubscriptionBell
        postId={postId}
        initialStatus={subscriptionStatus}
        disabled={!isMember}
      />
    </div>
  )
}
