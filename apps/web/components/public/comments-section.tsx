'use client'

import { useRouter } from 'next/navigation'
import { CommentThread } from './comment-thread'

interface Comment {
  id: string
  content: string
  authorName: string | null
  createdAt: Date
  parentId: string | null
  replies: Comment[]
}

interface CommentsSectionProps {
  postId: string
  comments: Comment[]
  allowCommenting?: boolean
}

export function CommentsSection({ postId, comments, allowCommenting = true }: CommentsSectionProps) {
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
    />
  )
}
