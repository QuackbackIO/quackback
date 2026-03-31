import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { CommentThread } from './comment-thread'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { useEnsureAnonSession } from '@/lib/client/hooks/use-ensure-anon-session'
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
  /** Hide the comment form area entirely (for readonly previews) */
  hideCommentForm?: boolean
  /** Callback when a comment is deleted */
  onDeleteComment?: (commentId: CommentId) => void
  /** ID of the comment currently being deleted */
  deletingCommentId?: CommentId | null
  /** Callback when a comment is restored (team only) */
  onRestoreComment?: (commentId: CommentId) => void
  /** ID of the comment currently being restored */
  restoringCommentId?: CommentId | null
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
  hideCommentForm,
  onDeleteComment,
  deletingCommentId,
  onRestoreComment,
  restoringCommentId,
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

  // Check if anonymous commenting is enabled in workspace settings
  const anonymousCommentingEnabled =
    settings?.publicPortalConfig?.features?.anonymousCommenting ?? false

  // Get user from session (anonymous sessions can comment only if the setting is enabled)
  const isAnonymous = session?.user?.principalType === 'anonymous'
  const user = session?.user && (!isAnonymous || anonymousCommentingEnabled) ? session.user : null
  const isLoggedIn = !!user

  // Can comment if: logged in with server permission, OR anonymous commenting is enabled
  // (even without a session — the session will be created lazily on comment submit)
  const allowCommenting = (isLoggedIn && serverAllowCommenting) || anonymousCommentingEnabled

  // User info from session, falling back to server-provided user
  const userData = user
    ? { name: user.name ?? null, email: user.email ?? '', principalId: serverUser?.principalId }
    : serverUser

  const ensureAnonSession = useEnsureAnonSession()

  // Use mutation hook with optimistic updates
  const baseMutation = useCreateComment({
    postId,
    author: userData,
  })

  // Wrap mutation to lazily create anonymous session before commenting
  const createComment = useMemo(() => {
    if (!anonymousCommentingEnabled) return baseMutation
    return {
      ...baseMutation,
      mutate: (
        input: Parameters<typeof baseMutation.mutate>[0],
        options?: Parameters<typeof baseMutation.mutate>[1]
      ) => {
        ensureAnonSession()
          .then((ok) => {
            if (ok) baseMutation.mutate(input, options)
          })
          .catch(() => {})
      },
      mutateAsync: async (
        input: Parameters<typeof baseMutation.mutateAsync>[0],
        options?: Parameters<typeof baseMutation.mutateAsync>[1]
      ) => {
        const ok = await ensureAnonSession()
        if (!ok) throw new Error('Failed to create session')
        return baseMutation.mutateAsync(input, options)
      },
    } as typeof baseMutation
  }, [anonymousCommentingEnabled, baseMutation, ensureAnonSession])

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
      hideCommentForm={hideCommentForm}
      onDeleteComment={onDeleteComment}
      deletingCommentId={deletingCommentId}
      onRestoreComment={onRestoreComment}
      restoringCommentId={restoringCommentId}
    />
  )
}
