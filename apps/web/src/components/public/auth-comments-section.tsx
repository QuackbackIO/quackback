import { useQueryClient } from '@tanstack/react-query'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { CommentThread } from './comment-thread'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { useCreateComment } from '@/lib/client/mutations'
import type { PublicCommentView } from '@/lib/client/queries/portal-detail'
import type { CommentId, PostId, PrincipalId } from '@quackback/ids'

interface AuthCommentsSectionProps {
  postId: PostId
  comments: PublicCommentView[]
  /** Server-determined: user is authenticated member who can comment */
  allowCommenting?: boolean
  user?: { name: string | null; email: string; principalId?: PrincipalId }
  /** Message to show when comments are locked (overrides "Sign in to comment") */
  lockedMessage?: string
  /** ID of the pinned comment (for showing pinned indicator) */
  pinnedCommentId?: string | null
  // Admin mode props
  /** Enable comment pinning (admin only) */
  canPinComments?: boolean
  /** Callback when comment is pinned */
  onPinComment?: (commentId: CommentId) => void
  /** Callback when comment is unpinned */
  onUnpinComment?: () => void
  /** Whether pin/unpin is in progress */
  isPinPending?: boolean
  // Status change props (admin only)
  /** Available statuses for the comment form status selector */
  statuses?: Array<{ id: string; name: string; color: string }>
  /** Current post status ID */
  currentStatusId?: string | null
  /** Whether the current user is a team member */
  isTeamMember?: boolean
}

/**
 * CommentsSection wrapper that reactively handles auth state.
 * - Shows comment form when logged in
 * - Shows "Sign in to comment" when logged out
 * - Updates reactively on login/logout without page refresh
 * - Uses optimistic updates for instant comment appearance
 */
export function AuthCommentsSection({
  postId,
  comments,
  allowCommenting: serverAllowCommenting = false,
  user: serverUser,
  lockedMessage,
  pinnedCommentId,
  canPinComments = false,
  onPinComment,
  onUnpinComment,
  isPinPending = false,
  statuses,
  currentStatusId,
  isTeamMember,
}: AuthCommentsSectionProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { session, settings } = useRouteContext({ from: '__root__' })
  // Use safe version - returns null in admin context where provider isn't available
  const authPopover = useAuthPopoverSafe()

  // Refresh page on auth change to get updated server state (member status, user data)
  useAuthBroadcast({
    onSuccess: () => {
      // Invalidate auth-dependent queries so they refetch with new session
      queryClient.invalidateQueries({ queryKey: ['comments-section', postId] })
      queryClient.invalidateQueries({ queryKey: ['vote-sidebar', postId] })
      queryClient.invalidateQueries({ queryKey: ['votedPosts'] })
      router.invalidate()
    },
  })

  // Get user from session
  const user = session?.user
  const isLoggedIn = !!user

  // Can comment only if logged in (reactive check)
  const allowCommenting = isLoggedIn && serverAllowCommenting

  // User info from session, falling back to server-provided user
  const userData = user
    ? { name: user.name ?? null, email: user.email ?? '', principalId: serverUser?.principalId }
    : serverUser

  // Use mutation hook with optimistic updates
  const createComment = useCreateComment({
    postId,
    author: userData,
  })

  return (
    <CommentThread
      postId={postId}
      comments={comments}
      allowCommenting={allowCommenting}
      user={userData}
      teamBadgeLogoUrl={settings?.brandingData?.logoUrl ?? undefined}
      lockedMessage={lockedMessage}
      onAuthRequired={() => authPopover?.openAuthPopover({ mode: 'login' })}
      createComment={createComment}
      pinnedCommentId={pinnedCommentId}
      canPinComments={canPinComments}
      onPinComment={onPinComment}
      onUnpinComment={onUnpinComment}
      isPinPending={isPinPending}
      statuses={statuses}
      currentStatusId={currentStatusId}
      isTeamMember={isTeamMember}
    />
  )
}
