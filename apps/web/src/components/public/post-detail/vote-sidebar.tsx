import { useSuspenseQuery } from '@tanstack/react-query'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { Skeleton } from '@/components/ui/skeleton'
import { portalDetailQueries } from '@/lib/client/queries/portal-detail'
import type { PostId } from '@quackback/ids'

const SIDEBAR_CLASS =
  'flex flex-col items-center justify-start py-6 px-4 border-r !border-r-[rgba(0,0,0,0.05)] dark:!border-r-[rgba(255,255,255,0.06)] bg-muted/10'

export function VoteSidebarSkeleton(): React.ReactElement {
  return (
    <div className={SIDEBAR_CLASS}>
      <Skeleton className="h-16 w-12 rounded-xl" />
    </div>
  )
}

interface VoteSidebarProps {
  postId: PostId
  voteCount: number
  /** Disable voting (e.g. for merged posts) */
  disabled?: boolean
}

export function VoteSidebar({ postId, voteCount, disabled }: VoteSidebarProps): React.ReactElement {
  const { data: sidebarData } = useSuspenseQuery(portalDetailQueries.voteSidebarData(postId))
  const isMember = sidebarData?.isMember ?? false

  return (
    <div className={`${SIDEBAR_CLASS} animate-in fade-in duration-200 fill-mode-backwards`}>
      <AuthVoteButton postId={postId} voteCount={voteCount} disabled={disabled || !isMember} />
    </div>
  )
}
