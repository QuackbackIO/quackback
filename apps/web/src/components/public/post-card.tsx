import { Link } from '@tanstack/react-router'
import {
  ChevronUpIcon,
  ChatBubbleLeftIcon,
  EllipsisHorizontalIcon,
  PencilIcon,
  TrashIcon,
  LinkIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusBadge } from '@/components/ui/status-badge'
import { StatusDropdown } from '@/components/shared/status-dropdown'
import { TimeAgo } from '@/components/ui/time-ago'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PostStatusEntity } from '@/lib/db-types'
import { usePostVote } from '@/lib/client/hooks/use-post-vote'
import { cn, getInitials } from '@/lib/utils'
import type { PostId, StatusId } from '@quackback/ids'

export type PostCardDensity = 'comfortable' | 'compact'

interface PostCardProps {
  id: PostId
  title: string
  content: string | null
  statusId: StatusId | null
  statuses: PostStatusEntity[]
  voteCount: number
  commentCount: number
  authorName: string | null
  authorAvatarUrl?: string | null
  createdAt: Date | string
  boardSlug: string
  boardName?: string
  tags: { id: string; name: string; color?: string }[]

  // Portal mode props
  /** Whether the user is authenticated (shows login dialog on vote if false) */
  isAuthenticated?: boolean
  /** Whether the current user is the author of this post */
  isCurrentUserAuthor?: boolean
  /** Whether the user can edit this post */
  canEdit?: boolean
  /** Whether the user can delete this post */
  canDelete?: boolean
  /** Reason why editing is not allowed (shown in tooltip) */
  editReason?: string
  /** Reason why deletion is not allowed (shown in tooltip) */
  deleteReason?: string
  /** Callback when user clicks edit */
  onEdit?: () => void
  /** Callback when user clicks delete */
  onDelete?: () => void

  // Admin mode props
  /** Enable admin mode with editable status */
  canChangeStatus?: boolean
  /** Callback when status changes (required if canChangeStatus) */
  onStatusChange?: (statusId: StatusId) => void
  /** Whether status update is in progress */
  isUpdatingStatus?: boolean
  /** Enable keyboard focus state (left border indicator) */
  isFocused?: boolean
  /** Use onClick instead of Link navigation */
  onClick?: () => void
  /** Hover state handlers for quick actions visibility */
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  /** Whether to show quick actions (controlled by parent hover state) */
  showQuickActions?: boolean
  /** Whether to show avatar in meta row */
  showAvatar?: boolean

  /** Display density: comfortable (default) or compact */
  density?: PostCardDensity
}

export function PostCard({
  id,
  title,
  content,
  statusId,
  statuses,
  voteCount,
  commentCount,
  authorName,
  authorAvatarUrl,
  createdAt,
  boardSlug,
  boardName,
  tags,
  isAuthenticated = true,
  isCurrentUserAuthor = false,
  canEdit = false,
  canDelete = false,
  editReason,
  deleteReason,
  onEdit,
  onDelete,
  canChangeStatus = false,
  onStatusChange,
  isUpdatingStatus = false,
  isFocused = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  showQuickActions = false,
  showAvatar = true,
  density = 'comfortable',
}: PostCardProps): React.ReactElement {
  // Safe hook - returns null in admin context where AuthPopoverProvider isn't available
  const authPopover = useAuthPopoverSafe()
  const isCompact = density === 'compact'
  const isAdminMode = canChangeStatus || !!onClick
  const currentStatus = statuses.find((s) => s.id === statusId)
  const createdAtDate = typeof createdAt === 'string' ? new Date(createdAt) : createdAt

  // Vote handling - only used in portal mode
  const {
    voteCount: currentVoteCount,
    hasVoted: currentHasVoted,
    isPending: isVotePending,
    handleVote,
  } = usePostVote({ postId: id, voteCount })

  function handleVoteClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (!isAuthenticated) {
      e.preventDefault()
      authPopover?.openAuthPopover({ mode: 'login' })
      return
    }
    handleVote(e)
  }

  async function handleCopyLink(): Promise<void> {
    try {
      const url = `${window.location.origin}/admin/feedback/posts/${id}`
      await navigator.clipboard.writeText(url)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  // Vote button - always interactive
  const voteButton = (
    <button
      type="button"
      data-testid="vote-button"
      aria-label={
        currentHasVoted
          ? `Remove vote (${currentVoteCount} votes)`
          : `Vote for this post (${currentVoteCount} votes)`
      }
      aria-pressed={currentHasVoted}
      onClick={handleVoteClick}
      disabled={isVotePending}
      className={cn(
        'group/vote flex flex-col items-center justify-center shrink-0 self-center rounded-lg border transition-all duration-200',
        isCompact ? 'w-11 py-1.5 mx-2' : 'w-13 py-2 mx-3',
        currentHasVoted
          ? 'post-card__vote--voted text-[var(--post-card-voted-color)] bg-[var(--post-card-voted-color)]/10 border-[var(--post-card-voted-color)]/30'
          : 'text-muted-foreground bg-muted/40 border-border/50 hover:bg-muted/60 hover:border-border',
        isVotePending && 'opacity-70 cursor-wait'
      )}
    >
      <ChevronUpIcon
        className={cn(
          'transition-transform duration-200',
          isCompact ? 'h-4 w-4' : 'h-5 w-5',
          currentHasVoted && 'fill-[var(--post-card-voted-color)]',
          !isVotePending && 'group-hover/vote:-translate-y-0.5'
        )}
      />
      <span
        data-testid="vote-count"
        className={cn(
          'font-semibold tabular-nums',
          isCompact ? 'text-sm' : 'text-base',
          !currentHasVoted && 'text-foreground'
        )}
      >
        {currentVoteCount}
      </span>
    </button>
  )

  // Status display - editable dropdown in admin, static badge in portal
  const statusDisplay =
    canChangeStatus && onStatusChange ? (
      <StatusDropdown
        currentStatus={currentStatus}
        statuses={statuses}
        onStatusChange={onStatusChange}
        disabled={isUpdatingStatus}
        variant="badge"
      />
    ) : currentStatus ? (
      <StatusBadge name={currentStatus.name} color={currentStatus.color} className="mb-1" />
    ) : null

  // Admin quick actions (status dropdown button + more actions)
  const adminQuickActions = isAdminMode && showQuickActions && (
    <div
      className={cn(
        'absolute right-2 top-1/2 -translate-y-1/2',
        'flex items-center gap-0.5',
        'transition-opacity duration-150'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Status dropdown (button variant) */}
      {canChangeStatus && onStatusChange && (
        <StatusDropdown
          currentStatus={currentStatus}
          statuses={statuses}
          onStatusChange={onStatusChange}
          disabled={isUpdatingStatus}
          variant="button"
        />
      )}

      {/* More actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50">
            <EllipsisHorizontalIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => window.open(`/b/${boardSlug}/posts/${id}`, '_blank')}>
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            View in Portal
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyLink}>
            <LinkIcon className="h-4 w-4" />
            Copy Link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  // Portal author quick actions (edit/delete)
  const portalQuickActions = !isAdminMode && isCurrentUserAuthor && (
    <div className="absolute right-2 top-1/2 -translate-y-1/2" onClick={(e) => e.stopPropagation()}>
      <TooltipProvider>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.preventDefault()}
              className="p-1 -m-1 rounded hover:bg-muted/50 transition-colors"
              aria-label="Post options"
            >
              <EllipsisHorizontalIcon className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.preventDefault()}>
            {canEdit ? (
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault()
                  onEdit?.()
                }}
              >
                <PencilIcon className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuItem disabled>
                    <PencilIcon className="h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>{editReason || 'Edit not allowed'}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {canDelete ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault()
                  onDelete?.()
                }}
              >
                <TrashIcon className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuItem disabled>
                    <TrashIcon className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>{deleteReason || 'Delete not allowed'}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    </div>
  )

  // Main content
  const cardContent = (
    <>
      {/* Vote column */}
      {voteButton}

      {/* Main content */}
      <div className={cn('flex-1 min-w-0', isCompact ? 'px-2 py-1.5' : 'px-3 py-2.5')}>
        {/* Compact: Inline status and title */}
        {isCompact ? (
          <div className="flex items-center gap-2 mb-0.5">
            {statusDisplay}
            <h3 className="font-medium text-sm text-foreground line-clamp-1 flex-1 pr-20">
              {title}
            </h3>
          </div>
        ) : (
          <>
            {/* Status badge/dropdown - above title */}
            {statusDisplay}
            {/* Title */}
            <h3 className="font-medium text-sm text-foreground line-clamp-1 pr-24">{title}</h3>
          </>
        )}

        {/* Description - hidden in compact mode */}
        {!isCompact && content && (
          <p className="text-xs text-muted-foreground/70 line-clamp-1 mt-0.5 pr-24">{content}</p>
        )}

        {/* Tags - own row, hidden in compact mode */}
        {!isCompact && tags.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            {tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="text-[10px] font-normal px-1.5 py-0"
              >
                {tag.name}
              </Badge>
            ))}
            {tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground/60">+{tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Meta row */}
        <div
          className={cn(
            'flex items-center text-muted-foreground',
            isCompact ? 'gap-1.5 text-[11px] mt-0.5' : 'gap-2 text-xs mt-1.5'
          )}
        >
          {showAvatar && (
            <Avatar className={isCompact ? 'h-4 w-4' : 'h-5 w-5'}>
              {authorAvatarUrl && (
                <AvatarImage src={authorAvatarUrl} alt={authorName || 'Author'} />
              )}
              <AvatarFallback className={cn('bg-muted', isCompact ? 'text-[8px]' : 'text-[10px]')}>
                {getInitials(authorName)}
              </AvatarFallback>
            </Avatar>
          )}
          <span className={showAvatar ? '' : 'text-foreground/80'}>
            {authorName || 'Anonymous'}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <TimeAgo date={createdAtDate} className="text-muted-foreground/70" />
          {commentCount > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5 text-muted-foreground/70">
                <ChatBubbleLeftIcon className={isCompact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
                {commentCount}
              </span>
            </>
          )}
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground/70">in {boardName || boardSlug}</span>
        </div>
      </div>

      {/* Quick actions */}
      {adminQuickActions}
      {portalQuickActions}
    </>
  )

  const rootClassName = cn(
    'post-card flex cursor-pointer transition-colors relative group',
    isFocused
      ? 'bg-muted/50 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-primary'
      : 'hover:bg-muted/30',
    isCompact ? 'py-1 px-2' : 'py-1 px-3'
  )

  // Render as div with onClick for modal navigation, or Link for full-page navigation
  if (onClick) {
    return (
      <div
        className={rootClassName}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        data-post-id={id}
      >
        {cardContent}
      </div>
    )
  }

  return (
    <Link
      to="/b/$slug/posts/$postId"
      params={{ slug: boardSlug, postId: id }}
      className={rootClassName}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-post-id={id}
    >
      {cardContent}
    </Link>
  )
}
