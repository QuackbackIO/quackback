import { useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { authClient } from '@/lib/server/auth/client'
import { VoteButton } from './vote-button'
import type { PostId } from '@quackback/ids'

interface AuthVoteButtonProps {
  postId: PostId
  voteCount: number
  /** Whether voting is disabled (e.g. merged post) */
  disabled?: boolean
  /** Whether anonymous voting is allowed (sign in silently instead of showing auth dialog) */
  canVote?: boolean
  /** Compact horizontal variant for inline use */
  compact?: boolean
}

/**
 * VoteButton wrapper that shows auth dialog when unauthenticated user tries to vote.
 * When canVote is true, silently signs in anonymously before the vote fires.
 */
export function AuthVoteButton({
  postId,
  voteCount,
  disabled = false,
  canVote = false,
  compact = false,
}: AuthVoteButtonProps): React.ReactElement {
  const router = useRouter()
  const { openAuthPopover } = useAuthPopover()
  const hasSessionRef = useRef(false)

  function handleAuthRequired(): void {
    openAuthPopover({ mode: 'login' })
  }

  // Called before each vote — ensures an anonymous session exists
  const handleBeforeVote = useCallback(async (): Promise<boolean> => {
    if (!canVote) return true
    if (hasSessionRef.current) return true
    try {
      const result = await authClient.signIn.anonymous()
      if (result.error) {
        console.error('[auth-vote-button] Anonymous sign-in failed:', result.error)
        return false
      }
      hasSessionRef.current = true
      // Let the browser commit the session cookie before the vote fires
      await new Promise((r) => setTimeout(r, 0))
      // Refresh session state so the header updates to show logged-in avatar
      router.invalidate()
      return true
    } catch (error) {
      console.error('[auth-vote-button] Anonymous sign-in failed:', error)
      return false
    }
  }, [canVote, router])

  return (
    <VoteButton
      postId={postId}
      voteCount={voteCount}
      disabled={disabled}
      onAuthRequired={disabled ? handleAuthRequired : undefined}
      onBeforeVote={canVote ? handleBeforeVote : undefined}
      compact={compact}
    />
  )
}
