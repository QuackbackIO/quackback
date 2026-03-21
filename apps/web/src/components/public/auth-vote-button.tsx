import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { useEnsureAnonSession } from '@/lib/client/hooks/use-ensure-anon-session'
import { VoteButton } from './vote-button'
import type { PostId } from '@quackback/ids'

interface AuthVoteButtonProps {
  postId: PostId
  voteCount: number
  /** Whether voting is structurally disabled (e.g. merged post) */
  disabled?: boolean
  /** Whether the current user can vote (anonymous voting enabled or logged in) */
  canVote?: boolean
  /** Compact horizontal variant for inline use */
  compact?: boolean
  /** Pill variant — vertical, self-stretches to parent height */
  pill?: boolean
}

/**
 * VoteButton wrapper that handles authentication.
 * - canVote=true: silently signs in anonymously before the vote fires
 * - canVote=false, disabled=false: button looks normal, clicking opens login dialog
 * - disabled=true: button is visually disabled (e.g. merged post)
 */
export function AuthVoteButton({
  postId,
  voteCount,
  disabled = false,
  canVote = false,
  compact = false,
  pill = false,
}: AuthVoteButtonProps): React.ReactElement {
  const { openAuthPopover } = useAuthPopover()
  const ensureAnonSession = useEnsureAnonSession()

  function handleAuthRequired(): void {
    openAuthPopover({ mode: 'login' })
  }

  // Needs login: not structurally disabled, but user can't vote yet
  const needsAuth = !disabled && !canVote

  return (
    <VoteButton
      postId={postId}
      voteCount={voteCount}
      disabled={disabled}
      onAuthRequired={needsAuth ? handleAuthRequired : undefined}
      onBeforeVote={canVote ? ensureAnonSession : undefined}
      compact={compact}
      pill={pill}
    />
  )
}
