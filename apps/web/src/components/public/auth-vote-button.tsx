import { useIntl } from 'react-intl'
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
  /** Whether the viewer is a signed-in real user (drives authz vs authn copy) */
  isAuthenticated?: boolean
  /** Compact horizontal variant for inline use */
  compact?: boolean
  /** Pill variant — vertical, self-stretches to parent height */
  pill?: boolean
}

/**
 * VoteButton wrapper that handles authentication AND authorization.
 * - canVote=true: silently signs in anonymously before the vote fires
 * - canVote=false, signed out: button looks normal, clicking opens login dialog
 * - canVote=false, signed in: denied by the board tier (authz) — dimmed with a
 *   "You don't have access to vote on this board" tooltip, no sign-in prompt
 * - disabled=true: button is visually disabled (e.g. merged post)
 */
export function AuthVoteButton({
  postId,
  voteCount,
  disabled = false,
  canVote = false,
  isAuthenticated = false,
  compact = false,
  pill = false,
}: AuthVoteButtonProps): React.ReactElement {
  const intl = useIntl()
  const { openAuthPopover } = useAuthPopover()
  const ensureAnonSession = useEnsureAnonSession()

  function handleAuthRequired(): void {
    openAuthPopover({ mode: 'login' })
  }

  const denied = !disabled && !canVote
  // Signed in but denied = authorization failure (board tier); otherwise the
  // denial is resolved by signing in.
  const needsAuth = denied && !isAuthenticated
  const noAccessReason =
    denied && isAuthenticated
      ? intl.formatMessage({
          id: 'portal.vote.noAccess',
          defaultMessage: "You don't have access to vote on this board",
        })
      : undefined

  return (
    <VoteButton
      postId={postId}
      voteCount={voteCount}
      disabled={disabled}
      onAuthRequired={needsAuth ? handleAuthRequired : undefined}
      noAccessReason={noAccessReason}
      onBeforeVote={canVote ? ensureAnonSession : undefined}
      compact={compact}
      pill={pill}
    />
  )
}
