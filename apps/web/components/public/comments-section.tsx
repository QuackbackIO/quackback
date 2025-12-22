'use client'

import { useRouter } from 'next/navigation'
import { CommentThread } from './comment-thread'
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

interface CommentsSectionProps {
  postId: PostId
  comments: Comment[]
  allowCommenting?: boolean
  /** Map of memberId to avatar URL (base64 or external URL) */
  avatarUrls?: Record<string, string | null>
  user?: { name: string | null; email: string }
}

export function CommentsSection({
  postId,
  comments,
  allowCommenting = true,
  avatarUrls,
  user,
}: CommentsSectionProps) {
  const router = useRouter()

  const handleCommentAdded = () => {
    // Refresh the page to show new comment
    router.refresh()
  }

  return (
    <CommentThread
      postId={postId}
      comments={comments}
      allowCommenting={allowCommenting}
      avatarUrls={avatarUrls}
      onCommentAdded={handleCommentAdded}
      user={user}
    />
  )
}
