'use client'

import { useState, useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import { CommentThread } from './comment-thread'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { useSession } from '@/lib/auth/client'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'
import type { PostId, CommentId } from '@quackback/ids'

interface CommentReaction {
  emoji: string
  count: number
  hasReacted: boolean
}

interface Comment {
  id: CommentId
  content: string
  authorName: string | null
  memberId: string | null
  createdAt: Date
  parentId: string | null
  isTeamMember: boolean
  replies: Comment[]
  reactions: CommentReaction[]
}

interface AuthCommentsSectionProps {
  postId: PostId
  comments: Comment[]
  /** Server-determined: user is authenticated member who can comment */
  allowCommenting?: boolean
  /** Map of memberId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  user?: { name: string | null; email: string }
}

/**
 * CommentsSection wrapper that reactively handles auth state.
 * - Shows comment form when logged in
 * - Shows "Sign in to comment" when logged out
 * - Updates reactively on login/logout without page refresh
 */
export function AuthCommentsSection({
  postId,
  comments,
  allowCommenting: serverAllowCommenting = false,
  avatarUrls,
  user: serverUser,
}: AuthCommentsSectionProps) {
  const router = useRouter()
  const { openAuthPopover } = useAuthPopover()

  // Hydration tracking to prevent SSR mismatch
  const [isHydrated, setIsHydrated] = useState(false)
  useEffect(() => setIsHydrated(true), [])

  // Client session for reactive auth state
  const { data: sessionData, isPending } = useSession()

  // Refresh page on auth change to get updated server state (member status, user data)
  useAuthBroadcast({ onSuccess: () => router.invalidate() })

  // Derive auth state: use server props during hydration, client session after
  const isSessionLoaded = isHydrated && !isPending
  const isLoggedIn = isSessionLoaded ? !!sessionData?.user : !!serverUser

  // Can comment only if logged in (reactive check)
  // When logged out (client detects no session), hide comment form even if server said OK
  const allowCommenting = isLoggedIn && serverAllowCommenting

  // User info from client session (reactive) or server props (SSR)
  const user =
    isSessionLoaded && sessionData?.user
      ? { name: sessionData.user.name ?? null, email: sessionData.user.email ?? '' }
      : serverUser

  return (
    <CommentThread
      postId={postId}
      comments={comments}
      allowCommenting={allowCommenting}
      avatarUrls={avatarUrls}
      onCommentAdded={() => router.invalidate()}
      user={user}
      onAuthRequired={() => openAuthPopover({ mode: 'login' })}
    />
  )
}
