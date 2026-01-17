import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { VoteButton } from './vote-button'
import type { PostId } from '@quackback/ids'

interface AuthVoteButtonProps {
  postId: PostId
  voteCount: number
  /** Whether voting is disabled (user not authenticated) */
  disabled?: boolean
  /** Compact horizontal variant for inline use */
  compact?: boolean
}

/**
 * VoteButton wrapper that shows auth dialog when unauthenticated user tries to vote.
 */
export function AuthVoteButton({
  postId,
  voteCount,
  disabled = false,
  compact = false,
}: AuthVoteButtonProps): React.ReactElement {
  const { openAuthPopover } = useAuthPopover()

  function handleAuthRequired(): void {
    openAuthPopover({ mode: 'login' })
  }

  return (
    <VoteButton
      postId={postId}
      voteCount={voteCount}
      disabled={disabled}
      onAuthRequired={disabled ? handleAuthRequired : undefined}
      compact={compact}
    />
  )
}
