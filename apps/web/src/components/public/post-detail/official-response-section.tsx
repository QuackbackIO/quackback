import { Suspense, lazy } from 'react'
import type { PinnedCommentView, PublicCommentView } from '@/lib/client/queries/portal-detail'

// The card loads only when a pinned comment is shown, so the admin roadmap
// modal does not carry it on first load.
const PinnedComment = lazy(() =>
  import('@/components/public/pinned-comment').then((m) => ({ default: m.PinnedComment }))
)

function threadHas(comments: readonly PublicCommentView[], id: string): boolean {
  return comments.some((c) => c.id === id || threadHas(c.replies ?? [], id))
}

interface PinnedCommentSectionProps {
  comment: PinnedCommentView
  workspaceName: string
  /**
   * The thread shown with it. When the thread holds the pinned comment, the
   * thread floats it to the top, so the card is not shown a second time.
   */
  comments?: readonly PublicCommentView[]
}

export function PinnedCommentSection({
  comment,
  workspaceName,
  comments,
}: PinnedCommentSectionProps) {
  if (comments && threadHas(comments, comment.id)) return null
  return (
    <div
      className="border-t border-border/30 p-6 animate-in fade-in duration-200 fill-mode-backwards"
      style={{ animationDelay: '100ms' }}
    >
      <Suspense fallback={null}>
        <PinnedComment comment={comment} workspaceName={workspaceName} />
      </Suspense>
    </div>
  )
}
