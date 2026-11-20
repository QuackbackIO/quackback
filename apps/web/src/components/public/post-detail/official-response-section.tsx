import { Suspense, lazy } from 'react'
import type { PinnedCommentView } from '@/lib/client/queries/portal-detail'

// The card loads only when a pinned comment is shown. The portal post page
// loads it the same way (thread-pinned-comment.tsx), so neither page carries
// it on first load.
const PinnedComment = lazy(() =>
  import('@/components/public/pinned-comment').then((m) => ({ default: m.PinnedComment }))
)

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
      <Suspense fallback={null}>
        <PinnedComment comment={comment} workspaceName={workspaceName} />
      </Suspense>
    </div>
  )
}
