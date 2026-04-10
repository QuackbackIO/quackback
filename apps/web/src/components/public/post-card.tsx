import { useState } from 'react'
import { useIntl } from 'react-intl'
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
import type { PostStatusEntity } from '@/lib/shared/db-types'
import { usePostVote } from '@/lib/client/hooks/use-post-vote'
import { cn, getInitials } from '@/lib/shared/utils'
import { useEnsureAnonSession } from '@/lib/client/hooks/use-ensure-anon-session'
import type { PostId, StatusId } from '@quackback/ids'

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
  tags: { id: string; name: string; color?: string }[]

  // Portal mode props
  /** Whether the user is authenticated (shows login dialog on vote if false) */
  isAuthenticated?: boolean
  /** Whether the user can vote (true if authenticated or anonymous voting enabled) */
  canVote?: boolean
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
  /** Use onClick instead of Link navigation */
  onClick?: () => void
  /** Hover state handlers for quick actions visibility */
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  /** Whether to show quick actions (controlled by parent hover state) */
  showQuickActions?: boolean
  /** Whether to show avatar in meta row */
  showAvatar?: boolean
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
  tags,
  isAuthenticated = true,
  canVote = true,
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
  onClick,
  onMouseEnter,
  onMouseLeave,
  showQuickActions = false,
  showAvatar = true,
}: PostCardProps): React.ReactElement {
  // Safe hook - returns null in admin context where AuthPopoverProvider isn't available
  const intl = useIntl()
  const authPopover = useAuthPopoverSafe()
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

  const [isAnonSigningIn, setIsAnonSigningIn] = useState(false)
  const ensureAnonSession = useEnsureAnonSession()

  async function handleVoteClick(e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    if (!isAuthenticated && !canVote) {
      e.preventDefault()
      authPopover?.openAuthPopover({ mode: 'login' })
      return
    }
    if (!isAuthenticated && canVote) {
      // Anonymous voting: sign in silently, then vote
      e.preventDefault()
      if (isAnonSigningIn) return
      setIsAnonSigningIn(true)
      try {
        const ok = await ensureAnonSession()
        if (!ok) return
      } finally {
        setIsAnonSigningIn(false)
      }
      handleVote()
      return
    }
    handleVote(e)
  }

  async function handleCopyLink(): Promise<void> {
    try {
      const url = `${window.location.origin}/admin/feedback?post=${id}`
      await navigator.clipboard.writeText(url)
      toast.success(
        intl.formatMessage({
          id: 'portal.postCard.toast.linkCopied',
          defaultMessage: 'Link copied to clipboard',
        })
      )
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'portal.postCard.toast.linkCopyFailed',
          defaultMessage: 'Failed to copy link',
        })
      )
    }
  }

  // Vote button - always interactive
  const voteButton = (
    <button
      type="button"
      data-testid="vote-button"
      aria-label={
        currentHasVoted
          ? intl.formatMessage(
              {
                id: 'portal.postCard.vote.ariaRemoveVote',
                defaultMessage: 'Remove vote ({count, plural, one {# vote} other {# votes}})',
              },
              { count: currentVoteCount }
            )
          : intl.formatMessage(
              {
                id: 'portal.postCard.vote.ariaVote',
                defaultMessage:
                  'Vote for this post ({count, plural, one {# vote} other {# votes}})',
              },
              { count: currentVoteCount }
            )
      }
      aria-pressed={currentHasVoted}
      onClick={handleVoteClick}
      disabled={isVotePending || isAnonSigningIn}
      className={cn(
        'group/vote flex flex-col items-center justify-center shrink-0 rounded-md border transition-colors duration-200',
        'w-12 py-2 gap-0.5',
        currentHasVoted
          ? 'post-card__vote--voted text-post-card-voted border-post-card-voted/60 bg-post-card-voted/15'
          : 'bg-muted/40 text-muted-foreground border-border/50 hover:border-border hover:bg-muted/60 hover:text-foreground/80',
        (isVotePending || isAnonSigningIn) && 'opacity-70 cursor-wait'
      )}
    >
      <ChevronUpIcon
        className={cn(
          'transition-transform duration-200 h-4 w-4',
          currentHasVoted && 'fill-post-card-voted',
          !isVotePending && 'group-hover/vote:-translate-y-0.5'
        )}
      />
      <span
        data-testid="vote-count"
        className={cn('font-semibold tabular-nums text-sm', !currentHasVoted && 'text-foreground')}
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
        'absolute end-2 top-1/2 -translate-y-1/2',
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
            {intl.formatMessage({
              id: 'portal.postCard.quickActions.viewInPortal',
              defaultMessage: 'View in Portal',
            })}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyLink}>
            <LinkIcon className="h-4 w-4" />
            {intl.formatMessage({
              id: 'portal.postCard.quickActions.copyLink',
              defaultMessage: 'Copy Link',
            })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  // Portal author quick actions (edit/delete)
  const portalQuickActions = !isAdminMode && isCurrentUserAuthor && (
    <div className="absolute end-2 top-1/2 -translate-y-1/2" onClick={(e) => e.stopPropagation()}>
      <TooltipProvider>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.preventDefault()}
              className="p-1 -m-1 rounded hover:bg-muted/50 transition-colors"
              aria-label={intl.formatMessage({
                id: 'portal.postCard.quickActions.options',
                defaultMessage: 'Post options',
              })}
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
                {intl.formatMessage({
                  id: 'portal.postCard.quickActions.edit',
                  defaultMessage: 'Edit',
                })}
              </DropdownMenuItem>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuItem disabled>
                    <PencilIcon className="h-4 w-4" />
                    {intl.formatMessage({
                      id: 'portal.postCard.quickActions.edit',
                      defaultMessage: 'Edit',
                    })}
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>
                    {editReason ||
                      intl.formatMessage({
                        id: 'portal.postCard.editNotAllowed',
                        defaultMessage: 'Edit not allowed',
                      })}
                  </p>
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
                {intl.formatMessage({
                  id: 'portal.postCard.quickActions.delete',
                  defaultMessage: 'Delete',
                })}
              </DropdownMenuItem>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuItem disabled>
                    <TrashIcon className="h-4 w-4" />
                    {intl.formatMessage({
                      id: 'portal.postCard.quickActions.delete',
                      defaultMessage: 'Delete',
                    })}
                  </DropdownMenuItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>
                    {deleteReason ||
                      intl.formatMessage({
                        id: 'portal.postCard.deleteNotAllowed',
                        defaultMessage: 'Delete not allowed',
                      })}
                  </p>
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
    <div className="flex items-start p-4 gap-4">
      {/* Vote column */}
      {voteButton}

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Status badge/dropdown - above title */}
        {statusDisplay}
        {/* Title */}
        <h3 className="font-semibold text-base text-foreground line-clamp-1">{title}</h3>

        {/* Description */}
        {content && <p className="text-sm text-muted-foreground/60 line-clamp-1 mt-1">{content}</p>}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium"
                style={{
                  backgroundColor: tag.color + '20',
                  color: tag.color,
                }}
              >
                {tag.name}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground/60">+{tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Meta row */}
        <div className="flex items-center text-muted-foreground gap-2 text-xs mt-2.5">
          {showAvatar && (
            <Avatar className="h-5 w-5">
              {authorAvatarUrl && (
                <AvatarImage
                  src={authorAvatarUrl}
                  alt={
                    authorName ||
                    intl.formatMessage({
                      id: 'portal.postCard.authorFallback',
                      defaultMessage: 'Anonymous',
                    })
                  }
                />
              )}
              <AvatarFallback className="bg-muted text-[10px]">
                {getInitials(authorName)}
              </AvatarFallback>
            </Avatar>
          )}
          <span className={showAvatar ? '' : 'text-foreground/80'}>
            {authorName ||
              intl.formatMessage({
                id: 'portal.postCard.authorFallback',
                defaultMessage: 'Anonymous',
              })}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <TimeAgo date={createdAtDate} className="text-muted-foreground/70" />
          {commentCount > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground/50 ms-auto">
              <ChatBubbleLeftIcon className="h-3.5 w-3.5" />
              {commentCount}
            </span>
          )}
        </div>
      </div>

      {/* Quick actions */}
      {adminQuickActions}
      {portalQuickActions}
    </div>
  )

  const rootClassName =
    'post-card cursor-pointer transition-colors relative group hover:bg-muted/20'

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
