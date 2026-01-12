import { VoteButton } from './vote-button'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import type { PostId } from '@quackback/ids'

interface AuthVoteButtonProps {
  postId: PostId
  voteCount: number
  /** Whether voting is disabled (user not authenticated) */
  disabled?: boolean
}

/**
 * VoteButton wrapper that shows auth dialog when unauthenticated user tries to vote.
 */
export function AuthVoteButton({ postId, voteCount, disabled = false }: AuthVoteButtonProps) {
  const { openAuthPopover } = useAuthPopover()

  const handleAuthRequired = () => {
    openAuthPopover({ mode: 'login' })
  }

  return (
    <VoteButton
      postId={postId}
      voteCount={voteCount}
      disabled={disabled}
      onAuthRequired={disabled ? handleAuthRequired : undefined}
    />
  )
}
