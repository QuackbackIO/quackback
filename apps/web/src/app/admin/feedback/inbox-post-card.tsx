'use client'

import { ChevronUp, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/utils'
import type { PostListItem, PostStatusEntity } from '@/lib/db'

interface InboxPostCardProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  isSelected: boolean
  onClick: () => void
}

export function InboxPostCard({ post, statuses, isSelected, onClick }: InboxPostCardProps) {
  const currentStatus = statuses.find((s) => s.id === post.statusId)

  return (
    <div
      className={cn(
        'flex cursor-pointer transition-colors relative',
        isSelected
          ? 'bg-muted/50 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-primary'
          : 'hover:bg-muted/30'
      )}
      onClick={onClick}
    >
      {/* Vote section */}
      <div className="flex flex-col items-center justify-center w-14 shrink-0 border-r border-border/30 text-muted-foreground py-3">
        <ChevronUp className="h-4 w-4" />
        <span className="text-sm font-bold text-foreground">{post.voteCount}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 px-3 py-3">
        {/* Status badge */}
        {currentStatus && (
          <StatusBadge name={currentStatus.name} color={currentStatus.color} className="mb-1.5" />
        )}

        {/* Title */}
        <h3 className="font-semibold text-[15px] text-foreground line-clamp-1">{post.title}</h3>

        {/* Excerpt */}
        <p className="text-sm text-muted-foreground/80 line-clamp-2 mt-1">{post.content}</p>

        {/* Meta row */}
        <div className="flex items-center gap-2.5 mt-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground/90">{post.authorName || 'Anonymous'}</span>
          <span className="text-muted-foreground/60">·</span>
          <TimeAgo date={new Date(post.createdAt)} />
          {post.commentCount > 0 && (
            <>
              <span className="text-muted-foreground/60">·</span>
              <span className="flex items-center gap-1 text-muted-foreground/70">
                <MessageSquare className="h-3 w-3" />
                {post.commentCount}
              </span>
            </>
          )}
          <div className="flex-1" />
          <Badge variant="secondary" className="text-[11px]">
            {post.board.name}
          </Badge>
        </div>

        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {post.tags.slice(0, 3).map((tag) => (
              <Badge key={tag.id} variant="secondary" className="text-[11px] font-normal">
                {tag.name}
              </Badge>
            ))}
            {post.tags.length > 3 && (
              <span className="text-[11px] text-muted-foreground">+{post.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
