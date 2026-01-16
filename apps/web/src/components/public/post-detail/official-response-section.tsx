import { OfficialResponse } from '@/components/public/official-response'
import { PinnedComment } from '@/components/public/pinned-comment'
import { Skeleton } from '@/components/ui/skeleton'
import type { PinnedCommentView } from '@/lib/queries/portal-detail'

export function OfficialResponseSectionSkeleton() {
  return (
    <div className="border-t border-border/30 p-6">
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="mt-3">
          <Skeleton className="h-3 w-40" />
        </div>
      </div>
    </div>
  )
}

interface OfficialResponseSectionProps {
  content: string
  authorName: string | null
  respondedAt: Date | string
  workspaceName: string
}

export function OfficialResponseSection({
  content,
  authorName,
  respondedAt,
  workspaceName,
}: OfficialResponseSectionProps) {
  return (
    <div className="border-t border-border/30 p-6">
      <OfficialResponse
        content={content}
        authorName={authorName}
        respondedAt={respondedAt}
        workspaceName={workspaceName}
      />
    </div>
  )
}

interface PinnedCommentSectionProps {
  comment: PinnedCommentView
  workspaceName: string
}

export function PinnedCommentSection({ comment, workspaceName }: PinnedCommentSectionProps) {
  return (
    <div className="border-t border-border/30 p-6">
      <PinnedComment comment={comment} workspaceName={workspaceName} />
    </div>
  )
}
