import { ChevronUpIcon } from '@heroicons/react/24/solid'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/outline'
import { Squares2X2Icon } from '@heroicons/react/24/solid'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'

interface CompactPostCardProps {
  title: string
  voteCount: number
  statusName?: string | null
  statusColor?: string | null
  description?: string | null
  authorName?: string | null
  boardName?: string | null
  commentCount?: number
  createdAt?: string | Date | null
  /** Badge rendered above the title (e.g. "Merges into") */
  label?: string
  /** Click handler — makes the whole card interactive */
  onClick?: () => void
  /** Custom vote slot (replaces the default static vote pill) */
  voteSlot?: React.ReactNode
  /** Right-side action slot (rendered outside the clickable area) */
  actions?: React.ReactNode
  className?: string
  /** Dashed border for preview cards */
  dashed?: boolean
}

export function CompactPostCard({
  title,
  voteCount,
  statusName,
  statusColor,
  description,
  authorName,
  boardName,
  commentCount,
  createdAt,
  label,
  voteSlot,
  onClick,
  actions,
  className,
  dashed = false,
}: CompactPostCardProps) {
  const hasMetaRow =
    boardName || createdAt || authorName || (commentCount != null && commentCount > 0)

  const content = (
    <div className="flex items-start gap-2.5">
      {/* Vote pill */}
      {voteSlot ?? (
        <div className="flex flex-col items-center justify-center shrink-0 self-stretch rounded-md border border-border/50 bg-muted/40 px-3.5 py-1.5 gap-1">
          <ChevronUpIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold tabular-nums text-foreground">{voteCount}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        {(label || statusName) && (
          <div className="flex items-center gap-1.5 mb-0.5">
            {label && (
              <span className="text-[10px] font-medium px-1.5 py-0 rounded-sm bg-muted text-muted-foreground/70">
                {label}
              </span>
            )}
            {statusName && (
              <StatusBadge name={statusName} color={statusColor ?? ''} className="text-[10px]" />
            )}
          </div>
        )}
        <p className="text-sm font-semibold text-foreground line-clamp-1">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground/60 line-clamp-1 mt-0.5">{description}</p>
        )}
        {hasMetaRow && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 mt-1.5">
            {boardName && (
              <>
                <Squares2X2Icon className="h-3 w-3 shrink-0 text-muted-foreground/40 -mr-1 mb-0.5" />
                <span className="truncate">{boardName}</span>
              </>
            )}
            {authorName && (
              <>
                {boardName && <span className="text-muted-foreground/30">&middot;</span>}
                <span className="truncate">{authorName}</span>
              </>
            )}
            {createdAt && (
              <>
                {(boardName || authorName) && (
                  <span className="text-muted-foreground/30">&middot;</span>
                )}
                <TimeAgo date={createdAt} className="shrink-0" />
              </>
            )}
            {commentCount != null && commentCount > 0 && (
              <span className="flex items-center gap-0.5 ml-auto shrink-0">
                <ChatBubbleLeftIcon className="h-3 w-3" />
                {commentCount}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )

  const baseClassName = cn(
    'min-w-0 w-full rounded-md border bg-muted/30 p-2.5 text-left',
    dashed ? 'border-dashed border-border/60' : 'border-border/60',
    onClick && 'cursor-pointer transition-colors hover:bg-muted/50 hover:border-border',
    className
  )

  if (actions) {
    const card = onClick ? (
      <button type="button" onClick={onClick} className={cn(baseClassName, 'flex-1')}>
        {content}
      </button>
    ) : (
      <div className={cn(baseClassName, 'flex-1')}>{content}</div>
    )

    return (
      <div className="flex items-center gap-2 min-w-0 w-full">
        {card}
        <div className="shrink-0 flex items-center gap-1">{actions}</div>
      </div>
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClassName}>
        {content}
      </button>
    )
  }

  return <div className={baseClassName}>{content}</div>
}
