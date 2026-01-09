import { useState, useCallback } from 'react'
import {
  EllipsisHorizontalIcon,
  PencilIcon,
  LinkIcon,
  ArrowTopRightOnSquareIcon,
  TrashIcon,
  CheckIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { PostListItem, PostStatusEntity } from '@/lib/db-types'
import type { StatusId } from '@quackback/ids'

interface RowQuickActionsProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  currentStatus: PostStatusEntity | undefined
  onStatusChange: (statusId: StatusId) => void
  onEdit?: () => void
  onDelete?: () => void
}

export function RowQuickActions({
  post,
  statuses,
  currentStatus,
  onStatusChange,
  onEdit,
  onDelete,
}: RowQuickActionsProps) {
  const [statusOpen, setStatusOpen] = useState(false)

  const handleCopyLink = useCallback(async () => {
    try {
      const url = `${window.location.origin}/admin/feedback/posts/${post.id}`
      await navigator.clipboard.writeText(url)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }, [post.id])

  const handleViewInPortal = useCallback(() => {
    window.open(`/b/${post.board.slug}/posts/${post.id}`, '_blank')
  }, [post.board.slug, post.id])

  return (
    <div className="flex items-center gap-0.5">
      {/* Status dropdown */}
      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded',
              'text-xs font-medium',
              'bg-card border border-border/50',
              'hover:bg-muted/50 transition-colors'
            )}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: currentStatus?.color || '#94a3b8' }}
            />
            <span className="max-w-[80px] truncate">{currentStatus?.name || 'No Status'}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1">
          {statuses.map((status) => (
            <button
              key={status.id}
              type="button"
              onClick={() => {
                onStatusChange(status.id)
                setStatusOpen(false)
              }}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm',
                'hover:bg-muted/50 transition-colors',
                status.id === currentStatus?.id && 'bg-muted/40'
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: status.color }}
              />
              <span className="flex-1 text-left truncate">{status.name}</span>
              {status.id === currentStatus?.id && (
                <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* More actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50">
            <EllipsisHorizontalIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {onEdit && (
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon className="h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleViewInPortal}>
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            View in Portal
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyLink}>
            <LinkIcon className="h-4 w-4" />
            Copy Link
          </DropdownMenuItem>
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onDelete} variant="destructive">
                <TrashIcon className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
