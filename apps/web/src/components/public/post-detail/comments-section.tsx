import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { portalDetailQueries, type PublicCommentView } from '@/lib/queries/portal-detail'
import { AuthCommentsSection } from '@/components/public/auth-comments-section'
import { Skeleton } from '@/components/ui/skeleton'
import type { PostId, MemberId } from '@quackback/ids'

/**
 * Recursively collect all member IDs from comments and their nested replies
 */
function collectCommentMemberIds(comments: PublicCommentView[]): string[] {
  const memberIds: string[] = []
  for (const comment of comments) {
    if (comment.memberId) {
      memberIds.push(comment.memberId)
    }
    if (comment.replies.length > 0) {
      memberIds.push(...collectCommentMemberIds(comment.replies))
    }
  }
  return memberIds
}

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
    <div className="border-t border-border/30 p-6">
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
}

export function CommentsSection({ postId, comments }: CommentsSectionProps) {
  const commentMemberIds = useMemo(() => collectCommentMemberIds(comments), [comments])
  const commentCount = useMemo(() => countAllComments(comments), [comments])

  // useSuspenseQuery reads from cache if available (prefetched in loader), fetches if not
  // Suspense boundary handles loading state, so no skeleton needed here
  const { data } = useSuspenseQuery(
    portalDetailQueries.commentsSectionData(postId, commentMemberIds as MemberId[])
  )

  return (
    <div className="border-t border-border/30 p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        {commentCount} {commentCount === 1 ? 'Comment' : 'Comments'}
      </h2>

      <AuthCommentsSection
        postId={postId}
        comments={comments}
        allowCommenting={data.canComment}
        avatarUrls={data.commentAvatarMap}
        user={data.user}
      />
    </div>
  )
}
