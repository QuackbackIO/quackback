import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { portalDetailQueries, type PublicCommentView } from '@/lib/client/queries/portal-detail'
import { AuthCommentsSection } from '@/components/public/auth-comments-section'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { PostCommentId, PostId } from '@quackback/ids'

/**
 * Recursively count all live (non-deleted) comments including nested replies
 */
function countAllComments(comments: PublicCommentView[]): number {
  let count = 0
  for (const comment of comments) {
    if (!comment.deletedAt) count += 1
    count += countAllComments(comment.replies)
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

export function CommentsSectionSkeleton({ count = 3 }: { count?: number }) {
  // Reserve one row per real comment (capped) so resolution doesn't shift
  // the layout; a post with no comments still gets one row for the header
  // and composer area.
  const rows = Math.max(1, Math.min(count, 6))
  return (
    <div className="p-6">
      <Skeleton className="h-4 w-24 mb-4" />
      <div className="space-y-6">
        {Array.from({ length: rows }, (_, i) => (
          <CommentSkeleton key={i} />
        ))}
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
  onPinComment?: (commentId: PostCommentId) => void
  /** Callback when comment is unpinned */
  onUnpinComment?: () => void
  /** Whether pin/unpin is in progress */
  isPinPending?: boolean
  /** Override user for admin context */
  adminUser?: { name: string | null; email: string }
  /** Disable new comment submission (e.g. for merged posts) */
  disableCommenting?: boolean
  /** Message to show when comments are locked (overrides "Sign in to comment") */
  lockedMessage?: string
  // Status change props (admin only)
  /** Available statuses for the comment form status selector */
  statuses?: Array<{ id: string; name: string; color: string }>
  /** Current post status ID */
  currentStatusId?: string | null
  /** Whether the current user is a team member */
  isTeamMember?: boolean
  /** Callback when a comment is deleted */
  onDeleteComment?: (commentId: PostCommentId) => void
  /** ID of the comment currently being deleted */
  deletingCommentId?: PostCommentId | null
  /** Callback when a comment is restored (team only) */
  onRestoreComment?: (commentId: PostCommentId) => void
  /** ID of the comment currently being restored */
  restoringCommentId?: PostCommentId | null
  // Pagination ("show more comments")
  /** Whether more root comments can be loaded beyond what's rendered. */
  hasMoreComments?: boolean
  /** Load the next page of root comments (appends into the tree). */
  onLoadMoreComments?: () => void
  /** Whether the next page is currently loading. */
  isLoadingMoreComments?: boolean
  /** Remaining root comments not yet loaded (for the button label). */
  remainingCommentCount?: number
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
  lockedMessage,
  statuses,
  currentStatusId,
  isTeamMember,
  onDeleteComment,
  deletingCommentId,
  onRestoreComment,
  restoringCommentId,
  hasMoreComments = false,
  onLoadMoreComments,
  isLoadingMoreComments = false,
  remainingCommentCount,
}: CommentsSectionProps) {
  const intl = useIntl()
  const commentCount = useMemo(() => countAllComments(comments), [comments])

  // useQuery reads from cache if available (prefetched in loader), fetches if not
  // Skip query in admin mode where we provide user directly
  const { data } = useQuery({
    ...portalDetailQueries.commentsSectionData(postId),
    enabled: !adminUser,
  })

  // Determine commenting permission: disabled overrides all, admin always allowed, portal uses server data
  let allowCommenting: boolean | undefined
  if (disableCommenting) {
    allowCommenting = false
  } else if (adminUser) {
    allowCommenting = true
  } else {
    allowCommenting = data?.canComment
  }

  // Use server-detected team membership when not in explicit admin mode
  const effectiveIsTeamMember = isTeamMember ?? data?.isTeamMember ?? false

  return (
    <div
      className="p-6 animate-in fade-in duration-200 fill-mode-backwards"
      style={{ animationDelay: '150ms' }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        {intl.formatMessage(
          {
            id: 'portal.postDetail.comments',
            defaultMessage: '{count, plural, one {# Comment} other {# Comments}}',
          },
          { count: commentCount }
        )}
      </h2>

      <AuthCommentsSection
        postId={postId}
        comments={comments}
        allowCommenting={allowCommenting}
        user={adminUser ?? data?.user}
        lockedMessage={lockedMessage}
        pinnedCommentId={pinnedCommentId}
        canPinComments={canPinComments || effectiveIsTeamMember}
        onPinComment={onPinComment}
        onUnpinComment={onUnpinComment}
        isPinPending={isPinPending}
        statuses={statuses}
        currentStatusId={currentStatusId}
        isTeamMember={effectiveIsTeamMember}
        // Portal (no adminUser) links comment authors to their public profile;
        // the admin post view keeps author names inert.
        linkAuthors={!adminUser}
        onDeleteComment={onDeleteComment}
        deletingCommentId={deletingCommentId}
        onRestoreComment={onRestoreComment}
        restoringCommentId={restoringCommentId}
        hideCommentForm={disableCommenting && !!adminUser}
      />

      {hasMoreComments && onLoadMoreComments && (
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isLoadingMoreComments}
            onClick={onLoadMoreComments}
          >
            {isLoadingMoreComments
              ? intl.formatMessage({
                  id: 'portal.postDetail.comments.loadingMore',
                  defaultMessage: 'Loading...',
                })
              : remainingCommentCount && remainingCommentCount > 0
                ? intl.formatMessage(
                    {
                      id: 'portal.postDetail.comments.showMoreCount',
                      defaultMessage:
                        'Show {count, plural, one {# more comment} other {# more comments}}',
                    },
                    { count: remainingCommentCount }
                  )
                : intl.formatMessage({
                    id: 'portal.postDetail.comments.showMore',
                    defaultMessage: 'Show more comments',
                  })}
          </Button>
        </div>
      )}
    </div>
  )
}
