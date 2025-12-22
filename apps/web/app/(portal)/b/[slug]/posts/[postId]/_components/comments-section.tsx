import type { PublicComment } from '@quackback/domain'
import { db, member, eq } from '@/lib/db'
import { getSession } from '@/lib/auth/server'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { AuthCommentsSection } from '@/components/public/auth-comments-section'
import { Skeleton } from '@/components/ui/skeleton'
import type { PostId } from '@quackback/ids'

/**
 * Recursively collect all member IDs from comments and their nested replies
 */
function collectCommentMemberIds(comments: PublicComment[]): string[] {
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
function countAllComments(comments: PublicComment[]): number {
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
  comments: PublicComment[]
}

export async function CommentsSection({ postId, comments }: CommentsSectionProps) {
  const session = await getSession()

  let isMember = false
  if (session?.user) {
    const memberRecord = await db.query.member.findFirst({
      where: eq(member.userId, session.user.id),
      columns: { id: true },
    })
    isMember = !!memberRecord
  }

  const canComment = isMember

  // Fetch avatar URLs for all comment authors
  const commentMemberIds = collectCommentMemberIds(comments)
  const commentAvatarMap = await getBulkMemberAvatarData(commentMemberIds)

  const commentCount = countAllComments(comments)

  return (
    <div className="border-t border-border/30 p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        {commentCount} {commentCount === 1 ? 'Comment' : 'Comments'}
      </h2>

      <AuthCommentsSection
        postId={postId}
        comments={comments}
        allowCommenting={canComment}
        avatarUrls={Object.fromEntries(commentAvatarMap)}
        user={session?.user ? { name: session.user.name, email: session.user.email } : undefined}
      />
    </div>
  )
}
