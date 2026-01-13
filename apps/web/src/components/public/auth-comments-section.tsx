import { useQueryClient } from '@tanstack/react-query'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { CommentThread } from './comment-thread'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'
import { useCreateComment } from '@/lib/hooks/use-comment-actions'
import type { PublicCommentView } from '@/lib/queries/portal-detail'
import type { PostId, MemberId } from '@quackback/ids'

interface AuthCommentsSectionProps {
  postId: PostId
  comments: PublicCommentView[]
  /** Server-determined: user is authenticated member who can comment */
  allowCommenting?: boolean
  /** Map of memberId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  user?: { name: string | null; email: string; memberId?: MemberId }
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
  avatarUrls,
  user: serverUser,
}: AuthCommentsSectionProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { session } = useRouteContext({ from: '__root__' })
  const { openAuthPopover } = useAuthPopover()

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
    ? { name: user.name ?? null, email: user.email ?? '', memberId: serverUser?.memberId }
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
      avatarUrls={avatarUrls}
      user={userData}
      onAuthRequired={() => openAuthPopover({ mode: 'login' })}
      createComment={createComment}
    />
  )
}
