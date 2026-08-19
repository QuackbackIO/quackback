import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MENU_LABEL } from '@/components/ui/menu'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { cn } from '@/lib/shared/utils'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import type { KbArticleId } from '@quackback/ids'

interface ArticleFeedbackReasonsDialogProps {
  articleId: KbArticleId
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * What visitors wrote when they voted this article unhelpful, newest first.
 *
 * The counter on the article says an article missed; these are the words that
 * say what it missed, which is what an editor needs before rewriting. Reasons
 * are read-only here: they are the visitor's own text, not an editable field.
 */
export function ArticleFeedbackReasonsDialog({
  articleId,
  open,
  onOpenChange,
}: ArticleFeedbackReasonsDialogProps) {
  const { data: reasons, isLoading } = useQuery({
    ...helpCenterQueries.articleFeedbackReasons(articleId),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unhelpful feedback</DialogTitle>
          <DialogDescription>
            What readers said was missing when they voted this article unhelpful.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <InlineSpinner visible />
            Loading feedback…
          </div>
        ) : reasons && reasons.length > 0 ? (
          <ScrollArea className="max-h-[60vh]">
            <ul className="flex flex-col gap-2 pr-3">
              {reasons.map((entry) => (
                <li
                  key={entry.id}
                  data-testid="article-feedback-reason"
                  className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5"
                >
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {entry.reason}
                  </p>
                  <p className={cn(MENU_LABEL, 'mt-1')}>
                    {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                  </p>
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <p className="py-6 text-sm text-muted-foreground">
            No one has explained an unhelpful vote on this article yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
