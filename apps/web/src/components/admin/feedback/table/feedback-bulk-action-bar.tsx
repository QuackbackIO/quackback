/**
 * The floating bulk-action bar for the feedback inbox: appears while a
 * multi-selection is active and applies one action — set status — to the whole
 * target set. It owns no server logic: the table view wires the status menu to
 * the bulk mutation (which fans the change out per post) and toasts the
 * summary. Mirrors the conversation inbox's bulk-action bar shape so both
 * inboxes read as one product.
 */
import { XMarkIcon, ChevronUpIcon } from '@heroicons/react/24/solid'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface FeedbackBulkActionBarProps {
  /** Number of posts the action targets. */
  count: number
  /** Available statuses for the value menu. */
  statuses: PostStatusEntity[]
  pending: boolean
  /** Clear the selection (dismisses the bar). */
  onClear: () => void
  /** Apply a status to the whole selection. */
  onChangeStatus: (statusId: string) => void
}

const triggerClass =
  'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'

export function FeedbackBulkActionBar({
  count,
  statuses,
  pending,
  onClear,
  onChangeStatus,
}: FeedbackBulkActionBarProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur"
      >
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XMarkIcon className="size-4" />
        </button>
        <span className="px-1.5 text-xs font-semibold whitespace-nowrap">{count} selected</span>
        <span className="mx-1 h-5 w-px bg-border" />

        {/* Set status on every selected post */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={pending} className={triggerClass}>
              Status
              <ChevronUpIcon className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              Set status
            </DropdownMenuLabel>
            {statuses.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={() => onChangeStatus(s.id)}
                className="flex items-center gap-2"
              >
                <span
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="truncate">{s.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
