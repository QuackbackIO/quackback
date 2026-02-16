import { PinnedComment } from '@/components/public/pinned-comment'
import type { PinnedCommentView } from '@/lib/client/queries/portal-detail'

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
