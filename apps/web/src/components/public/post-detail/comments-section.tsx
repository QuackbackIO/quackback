import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { portalDetailQueries, type PublicCommentView } from '@/lib/client/queries/portal-detail'
import { AuthCommentsSection } from '@/components/public/auth-comments-section'
import { Skeleton } from '@/components/ui/skeleton'
import type { CommentId, PostId } from '@quackback/ids'

/**
 * Recursively count all comments including nested replies
 */
function countAllComments(comments: PublicCommentView[]): number {
  let count = 0
  for (const comment of comments) {
    count += 1
    if (comment.replies && comment.replies.length > 0) {
      count += countAllComments(comment.replies)
    }
  }
  return count
}

function CommentSkeleton() {
  return (
    <div className="flex gap-3">
      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  )
}

export function CommentsSectionSkeleton() {
  return (
    <div className="p-6">
      <Skeleton className="h-4 w-24 mb-4" />
      <div className="space-y-6">
        <CommentSkeleton />
        <CommentSkeleton />
        <CommentSkeleton />
      </div>
    </div>
  )
}

interface CommentsSectionProps {
  postId: PostId
  comments: PublicCommentView[]
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
  /** Override user for admin context */
  adminUser?: { name: string | null; email: string }
  /** Disable new comment submission (e.g. for merged posts) */
  disableCommenting?: boolean
}

export function CommentsSection({
  postId,
  comments,
  pinnedCommentId,
  canPinComments = false,
  onPinComment,
  onUnpinComment,
  isPinPending = false,
  adminUser,
  disableCommenting = false,
}: CommentsSectionProps) {
  const commentCount = useMemo(() => countAllComments(comments), [comments])

  // useQuery reads from cache if available (prefetched in loader), fetches if not
  // Skip query in admin mode where we provide user directly
  const { data } = useQuery({
    ...portalDetailQueries.commentsSectionData(postId),
    enabled: !adminUser,
  })

  return (
    <div
      className="p-6 animate-in fade-in duration-200 fill-mode-backwards"
      style={{ animationDelay: '150ms' }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        {commentCount} {commentCount === 1 ? 'Comment' : 'Comments'}
      </h2>

      <AuthCommentsSection
        postId={postId}
        comments={comments}
        allowCommenting={disableCommenting ? false : adminUser ? true : data?.canComment}
        user={adminUser ?? data?.user}
        pinnedCommentId={pinnedCommentId}
        canPinComments={canPinComments}
        onPinComment={onPinComment}
        onUnpinComment={onUnpinComment}
        isPinPending={isPinPending}
      />
    </div>
  )
}
