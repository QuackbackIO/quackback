'use client'

import { VoteButton } from './vote-button'
import { useAuthPopover } from '@/components/auth/auth-popover-context'

interface AuthVoteButtonProps {
  postId: string
  initialVoteCount: number
  initialHasVoted: boolean
  /** Whether voting is disabled (user not authenticated) */
  disabled?: boolean
}

/**
 * VoteButton wrapper that shows auth dialog when unauthenticated user tries to vote.
 */
export function AuthVoteButton({
  postId,
  initialVoteCount,
  initialHasVoted,
  disabled = false,
}: AuthVoteButtonProps) {
  const { openAuthPopover } = useAuthPopover()

  const handleAuthRequired = () => {
    openAuthPopover({ mode: 'login' })
  }

  return (
    <VoteButton
      postId={postId}
      initialVoteCount={initialVoteCount}
      initialHasVoted={initialHasVoted}
      disabled={disabled}
      onAuthRequired={disabled ? handleAuthRequired : undefined}
    />
  )
}
