import { ChatBubbleLeftIcon, ChevronUpIcon } from '@heroicons/react/24/solid'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { StatusBadge } from '@/components/ui/status-badge'
import type { MergePreview } from './merge-preview'

interface MergeConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: MergePreview
  onConfirm: () => void
  isPending: boolean
}

export function MergeConfirmDialog({
  open,
  onOpenChange,
  preview,
  onConfirm,
  isPending,
}: MergeConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge into this post?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Votes and comments will be combined. Voters are only counted once.
              </p>

              {/* Merged result card */}
              <div className="flex items-start gap-2.5 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
                <div className="flex flex-col items-center shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-1 gap-0">
                  <ChevronUpIcon className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs font-semibold tabular-nums text-foreground">
                    {preview.voteCount}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  {preview.statusName && (
                    <div className="mb-0.5">
                      <StatusBadge
                        name={preview.statusName}
                        color={preview.statusColor}
                        className="text-[10px]"
                      />
                    </div>
                  )}
                  <p className="text-sm font-medium text-foreground line-clamp-2">
                    {preview.title}
                  </p>
                  {preview.content && (
                    <p className="text-xs text-muted-foreground/60 line-clamp-2 mt-0.5">
                      {preview.content}
                    </p>
                  )}
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                    <ChatBubbleLeftIcon className="h-3 w-3" />
                    <span>{preview.commentCount} comments</span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                The duplicate will redirect here for existing voters. You can undo this anytime.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Merging...' : 'Merge'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
