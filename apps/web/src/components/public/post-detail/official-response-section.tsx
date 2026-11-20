import { PinnedComment } from '@/components/public/pinned-comment'
import type { PinnedCommentView, PublicCommentView } from '@/lib/client/queries/portal-detail'

interface PinnedCommentSectionProps {
  comment: PinnedCommentView
  workspaceName: string
}

export function PinnedCommentSection({ comment, workspaceName }: PinnedCommentSectionProps) {
  return (
    <div
      className="border-t border-border/30 p-6 animate-in fade-in duration-200 fill-mode-backwards"
      style={{ animationDelay: '100ms' }}
    >
      <PinnedComment comment={comment} workspaceName={workspaceName} />
    </div>
  )
}

function threadHas(comments: readonly PublicCommentView[], id: string): boolean {
  return comments.some((c) => c.id === id || threadHas(c.replies ?? [], id))
}

interface ThreadPinnedCommentProps {
  pinnedComment: PinnedCommentView | null
  /** The comments the thread has loaded so far. */
  comments: readonly PublicCommentView[]
  workspaceName: string
}

/**
 * The pinned comment, above the thread, while the thread has not loaded it.
 * The first page holds only the newest roots, so an older pinned comment would
 * otherwise never show. Once loaded, the thread floats it to the top itself.
 */
export function ThreadPinnedComment({
  pinnedComment,
  comments,
  workspaceName,
}: ThreadPinnedCommentProps) {
  if (!pinnedComment || threadHas(comments, pinnedComment.id)) return null
  return (
    <div className="border-b border-border/30 p-6" data-testid="pinned-comment">
      <PinnedComment comment={pinnedComment} workspaceName={workspaceName} />
    </div>
  )
}
