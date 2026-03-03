import { ArrowDownIcon } from '@heroicons/react/16/solid'
import { ChevronUpIcon } from '@heroicons/react/24/solid'
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

interface PostCardData {
  title: string
  voteCount: number
  statusName?: string | null
  statusColor?: string | null
}

interface MergeConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  duplicatePost: PostCardData
  canonicalPost: PostCardData
  preview: MergePreview
  onConfirm: () => void
  isPending: boolean
}

export function MergeConfirmDialog({
  open,
  onOpenChange,
  duplicatePost,
  canonicalPost,
  preview,
  onConfirm,
  isPending,
}: MergeConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge these posts?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                The duplicate will be hidden and its votes and comments
                transferred to the surviving post.
              </p>

              {/* Direction visual — compact post cards stacked vertically */}
              <div className="space-y-1.5">
                <CompactPostCard post={duplicatePost} label="Duplicate" />
                <div className="flex items-center gap-1.5 pl-2 text-muted-foreground/50">
                  <ArrowDownIcon className="h-3 w-3 shrink-0" />
                  <span className="text-[11px]">merges into</span>
                </div>
                <CompactPostCard post={canonicalPost} />
              </div>

              {/* What happens list */}
              <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                <li>The duplicate post will be hidden from public view</li>
                <li>
                  Votes and comments will be combined ({preview.voteCount} votes,{' '}
                  {preview.commentCount} comments total)
                </li>
                <li>This can be reversed from the post detail page</li>
              </ul>
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

/** Extra-compact post card for use inside the dialog — vote count + status + title only. */
function CompactPostCard({
  post,
  label,
}: {
  post: PostCardData
  label?: string
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
      <div className="flex flex-col items-center shrink-0 rounded border border-border/50 bg-muted/40 px-1 py-0.5 gap-0">
        <ChevronUpIcon className="h-2.5 w-2.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold tabular-nums text-foreground">
          {post.voteCount}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        {(label || post.statusName) && (
          <div className="flex items-center gap-1.5 mb-0.5">
            {label && (
              <span className="text-[10px] font-medium px-1.5 py-0 rounded-sm bg-muted text-muted-foreground/70">
                {label}
              </span>
            )}
            {post.statusName && (
              <StatusBadge
                name={post.statusName}
                color={post.statusColor}
                className="text-[10px]"
              />
            )}
          </div>
        )}
        <p className="text-sm font-medium text-foreground line-clamp-2">{post.title}</p>
      </div>
    </div>
  )
}
