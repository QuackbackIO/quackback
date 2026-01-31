import { Link } from '@tanstack/react-router'
import { ChevronUpIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn, getInitials } from '@/lib/utils'
import type { PostStatusEntity } from '@/lib/db-types'
import type { PostId, StatusId } from '@quackback/ids'

export type PostListItemDensity = 'comfortable' | 'compact'

interface BasePostData {
  id: PostId
  title: string
  content: string | null
  statusId: StatusId | null
  voteCount: number
  commentCount: number
  authorName: string | null
  authorAvatarUrl?: string | null
  createdAt: Date | string
  boardSlug: string
  boardName?: string
  tags: { id: string; name: string; color?: string }[]
}

interface PostListItemProps {
  post: BasePostData
  statuses: PostStatusEntity[]
  /** Display density: comfortable (default) or compact */
  density?: PostListItemDensity
  /** Whether the item is focused (for keyboard navigation) */
  isFocused?: boolean
  /** Optional click handler - if provided, renders as div instead of Link */
  onClick?: () => void
  /** Render prop for vote button - allows custom vote behavior */
  renderVoteButton?: (props: {
    voteCount: number
    isCompact: boolean
    className: string
  }) => React.ReactNode
  /** Render prop for quick actions overlay (admin context) */
  renderQuickActions?: () => React.ReactNode
  /** Whether to show avatar in meta row */
  showAvatar?: boolean
  /** Additional className for the root element */
  className?: string
  /** Mouse event handlers for hover state */
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

/**
 * Shared post list item component used across portal and admin contexts.
 *
 * - Portal: Uses Link navigation, interactive vote button, author edit/delete
 * - Admin: Uses onClick for modal, quick actions overlay, display-only vote
 */
export function PostListItem({
  post,
  statuses,
  density = 'comfortable',
  isFocused = false,
  onClick,
  renderVoteButton,
  renderQuickActions,
  showAvatar = true,
  className,
  onMouseEnter,
  onMouseLeave,
}: PostListItemProps): React.ReactElement {
  const isCompact = density === 'compact'
  const currentStatus = statuses.find((s) => s.id === post.statusId)
  const createdAt = typeof post.createdAt === 'string' ? new Date(post.createdAt) : post.createdAt

  // Default vote display (non-interactive)
  const defaultVoteButton = (
    <div
      className={cn(
        'flex flex-col items-center justify-center shrink-0 border-r border-border/30',
        isCompact ? 'w-12 py-1.5' : 'w-16 py-2.5'
      )}
    >
      <ChevronUpIcon
        className={cn('text-muted-foreground', isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4')}
      />
      <span
        className={cn(
          'font-semibold text-foreground tabular-nums',
          isCompact ? 'text-xs' : 'text-sm'
        )}
      >
        {post.voteCount}
      </span>
    </div>
  )

  const content = (
    <>
      {/* Vote column */}
      {renderVoteButton
        ? renderVoteButton({
            voteCount: post.voteCount,
            isCompact,
            className: cn(
              'flex flex-col items-center justify-center shrink-0',
              isCompact ? 'w-12 py-1.5' : 'w-16 py-2.5'
            ),
          })
        : defaultVoteButton}

      {/* Main content */}
      <div className={cn('flex-1 min-w-0', isCompact ? 'px-2 py-1.5' : 'px-3 py-2.5')}>
        {/* Compact: Inline status and title */}
        {isCompact ? (
          <div className="flex items-center gap-2 mb-0.5">
            {currentStatus && (
              <StatusBadge
                name={currentStatus.name}
                color={currentStatus.color}
                className="text-[10px]"
              />
            )}
            <h3 className="font-medium text-sm text-foreground line-clamp-1 flex-1 pr-20">
              {post.title}
            </h3>
          </div>
        ) : (
          <>
            {/* Status badge - above title */}
            {currentStatus && (
              <StatusBadge name={currentStatus.name} color={currentStatus.color} className="mb-1" />
            )}
            {/* Title */}
            <h3 className="font-medium text-sm text-foreground line-clamp-1 pr-24">{post.title}</h3>
          </>
        )}

        {/* Description - hidden in compact mode */}
        {!isCompact && post.content && (
          <p className="text-xs text-muted-foreground/70 line-clamp-1 mt-0.5 pr-24">
            {post.content}
          </p>
        )}

        {/* Tags - own row, hidden in compact mode */}
        {!isCompact && post.tags.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5">
            {post.tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="text-[10px] font-normal px-1.5 py-0"
              >
                {tag.name}
              </Badge>
            ))}
            {post.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground/60">+{post.tags.length - 3}</span>
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
              {post.authorAvatarUrl && (
                <AvatarImage src={post.authorAvatarUrl} alt={post.authorName || 'Author'} />
              )}
              <AvatarFallback className={cn('bg-muted', isCompact ? 'text-[8px]' : 'text-[10px]')}>
                {getInitials(post.authorName)}
              </AvatarFallback>
            </Avatar>
          )}
          <span className={showAvatar ? '' : 'text-foreground/80'}>
            {post.authorName || 'Anonymous'}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <TimeAgo date={createdAt} className="text-muted-foreground/70" />
          {post.commentCount > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5 text-muted-foreground/70">
                <ChatBubbleLeftIcon className={isCompact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
                {post.commentCount}
              </span>
            </>
          )}
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground/70">in {post.boardName || post.boardSlug}</span>
        </div>
      </div>

      {/* Quick actions slot */}
      {renderQuickActions && (
        <div
          className="absolute right-2 top-1/2 -translate-y-1/2"
          onClick={(e) => e.stopPropagation()}
        >
          {renderQuickActions()}
        </div>
      )}
    </>
  )

  const rootClassName = cn(
    'post-list-item flex cursor-pointer transition-colors relative group',
    isFocused
      ? 'bg-muted/50 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-primary'
      : 'hover:bg-muted/30',
    className
  )

  // Render as div with onClick for modal navigation, or Link for full-page navigation
  if (onClick) {
    return (
      <div
        className={rootClassName}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        data-post-id={post.id}
      >
        {content}
      </div>
    )
  }

  return (
    <Link
      to="/b/$slug/posts/$postId"
      params={{ slug: post.boardSlug, postId: post.id }}
      className={rootClassName}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-post-id={post.id}
    >
      {content}
    </Link>
  )
}
