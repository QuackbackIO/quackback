import { useState } from 'react'
import { CheckIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StatusBadge } from '@/components/ui/status-badge'
import { cn } from '@/lib/utils'
import type { PostStatusEntity } from '@/lib/db-types'
import type { StatusId } from '@quackback/ids'

interface StatusDropdownProps {
  currentStatus: PostStatusEntity | undefined
  statuses: PostStatusEntity[]
  onStatusChange: (statusId: StatusId) => void
  disabled?: boolean
  /** Style variant: 'badge' (inline status badge) or 'button' (quick actions style) */
  variant?: 'badge' | 'button'
}

/**
 * Reusable status dropdown component.
 *
 * - 'badge' variant: Renders as a clickable StatusBadge (for inline use in PostCard)
 * - 'button' variant: Renders as a button with status dot (for quick actions overlay)
 */
export function StatusDropdown({
  currentStatus,
  statuses,
  onStatusChange,
  disabled = false,
  variant = 'badge',
}: StatusDropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  const handleStatusChange = (statusId: StatusId) => {
    onStatusChange(statusId)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {variant === 'badge' ? (
          <button
            type="button"
            className={cn(
              'inline-flex cursor-pointer transition-opacity',
              disabled && 'opacity-50 cursor-not-allowed',
              !disabled && 'hover:opacity-80'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {currentStatus ? (
              <StatusBadge name={currentStatus.name} color={currentStatus.color} className="mb-1" />
            ) : (
              <span className="text-xs text-muted-foreground">No status</span>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded',
              'text-xs font-medium',
              'bg-card border border-border/50',
              'hover:bg-muted/50 transition-colors',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: currentStatus?.color || '#94a3b8' }}
            />
            <span className="max-w-[80px] truncate">{currentStatus?.name || 'No Status'}</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1" onClick={(e) => e.stopPropagation()}>
        {statuses.map((status) => (
          <button
            key={status.id}
            type="button"
            onClick={() => handleStatusChange(status.id)}
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
  )
}
