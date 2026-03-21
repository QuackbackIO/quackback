import { CompactPostCard } from '@/components/shared/compact-post-card'
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
          <AlertDialogTitle>Merge this post?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>Votes and comments will be combined. Voters are only counted once.</p>

              {/* Merged result card */}
              <CompactPostCard
                title={preview.title}
                voteCount={preview.voteCount}
                statusName={preview.statusName}
                statusColor={preview.statusColor}
                description={preview.content}
                commentCount={preview.commentCount}
              />

              <p className="text-xs text-muted-foreground">
                The merged post will redirect here for existing voters. You can undo this anytime.
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
