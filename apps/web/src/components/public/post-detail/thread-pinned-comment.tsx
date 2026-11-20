import { Suspense, lazy } from 'react'
import type { PinnedCommentView, PublicCommentView } from '@/lib/client/queries/portal-detail'

// Loaded only when a pinned comment sits outside the loaded thread, which is
// rare, so the post page's first load does not carry it.
const PinnedComment = lazy(() =>
  import('@/components/public/pinned-comment').then((m) => ({ default: m.PinnedComment }))
)

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
      <Suspense fallback={null}>
        <PinnedComment comment={pinnedComment} workspaceName={workspaceName} />
      </Suspense>
    </div>
  )
}
