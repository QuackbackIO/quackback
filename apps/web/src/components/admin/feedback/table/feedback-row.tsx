import { useState } from 'react'
import { ChevronUpIcon, ChatBubbleLeftIcon, FolderIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/utils'
import { RowQuickActions } from './row-quick-actions'
import type { PostListItem, PostStatusEntity } from '@/lib/db-types'
import type { StatusId } from '@quackback/ids'

interface FeedbackRowProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  isFocused: boolean
  onClick: () => void
  onStatusChange: (statusId: StatusId) => void
}

export function FeedbackRow({
  post,
  statuses,
  isFocused,
  onClick,
  onStatusChange,
}: FeedbackRowProps) {
  const [isHovered, setIsHovered] = useState(false)
  const currentStatus = statuses.find((s) => s.id === post.statusId)

  return (
    <div
      className={cn(
        'flex cursor-pointer transition-colors relative group',
        isFocused
          ? 'bg-muted/50 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-primary'
          : 'hover:bg-muted/30'
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-post-id={post.id}
    >
      {/* Vote column - fixed width */}
      <div className="flex flex-col items-center justify-center w-16 shrink-0 border-r border-border/30 py-2.5">
        <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground tabular-nums">{post.voteCount}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 px-3 py-2.5">
        {/* Title row */}
        <h3 className="font-medium text-sm text-foreground line-clamp-1 pr-24">{post.title}</h3>

        {/* Preview - single line */}
        {post.content && (
          <p className="text-xs text-muted-foreground/70 line-clamp-1 mt-0.5 pr-24">
            {post.content}
          </p>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
          {currentStatus && (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: currentStatus.color }}
              />
              <span className="text-foreground/80">{currentStatus.name}</span>
            </span>
          )}
          {currentStatus && <span className="text-muted-foreground/40">·</span>}
          <span className="flex items-center gap-1">
            <FolderIcon className="h-3 w-3" />
            {post.board.name}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span>{post.authorName || 'Anonymous'}</span>
          <span className="text-muted-foreground/40">·</span>
          <TimeAgo date={new Date(post.createdAt)} className="text-muted-foreground/70" />
          {post.commentCount > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="flex items-center gap-0.5 text-muted-foreground/70">
                <ChatBubbleLeftIcon className="h-3 w-3" />
                {post.commentCount}
              </span>
            </>
          )}
          {/* Tags inline */}
          {post.tags.length > 0 && (
            <div className="flex items-center gap-1 ml-1">
              {post.tags.slice(0, 2).map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="text-[10px] font-normal px-1.5 py-0"
                >
                  {tag.name}
                </Badge>
              ))}
              {post.tags.length > 2 && (
                <span className="text-[10px] text-muted-foreground/60">
                  +{post.tags.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions - shown on hover */}
      <div
        className={cn(
          'absolute right-2 top-1/2 -translate-y-1/2',
          'flex items-center gap-1',
          'transition-opacity duration-150',
          isHovered || isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <RowQuickActions
          post={post}
          statuses={statuses}
          currentStatus={currentStatus}
          onStatusChange={onStatusChange}
        />
      </div>
    </div>
  )
}
