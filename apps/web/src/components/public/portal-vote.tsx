import { useQuery } from '@tanstack/react-query'
import type { PostId } from '@quackback/ids'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import { portalQueries } from '@/lib/client/queries/portal'

/**
 * A post's vote outside the feed, by the rules the feed votes by: the board's,
 * and the viewer's.
 */
export function PortalVote({
  post,
  pill,
}: {
  post: { id: string; voteCount: number; board?: { id: string } | null }
  /** Vertical, stretched to the height of what it sits beside. */
  pill?: boolean
}) {
  const session = useSessionContext()
  const { data } = useQuery(portalQueries.boardCapabilities())
  const isAuthenticated = !!session?.user && session.user.principalType !== 'anonymous'
  return (
    <AuthVoteButton
      postId={post.id as PostId}
      voteCount={post.voteCount}
      canVote={!!post.board && !!data?.permissions[post.board.id]?.canVote}
      isAuthenticated={isAuthenticated}
      pill={pill}
    />
  )
}
