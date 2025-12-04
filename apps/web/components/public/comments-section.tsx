'use client'

import { useRouter } from 'next/navigation'
import { CommentThread } from './comment-thread'

interface CommentReaction {
  emoji: string
  count: number
  hasReacted: boolean
}

interface Comment {
  id: string
  content: string
  authorName: string | null
  createdAt: Date
  parentId: string | null
  isTeamMember: boolean
  replies: Comment[]
  reactions: CommentReaction[]
}

interface CommentsSectionProps {
  postId: string
  comments: Comment[]
  allowCommenting?: boolean
  user?: { name: string | null; email: string }
}

export function CommentsSection({
  postId,
  comments,
  allowCommenting = true,
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
      onCommentAdded={handleCommentAdded}
      user={user}
    />
  )
}
