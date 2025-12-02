'use client'

import { ChevronUp, MessageSquare } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { PostListItem, PostStatus } from '@quackback/db'

const STATUS_CONFIG: Record<PostStatus, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  open: { label: 'Open', variant: 'default' },
  under_review: { label: 'Under Review', variant: 'secondary' },
  planned: { label: 'Planned', variant: 'secondary' },
  in_progress: { label: 'In Progress', variant: 'secondary' },
  complete: { label: 'Complete', variant: 'secondary' },
  closed: { label: 'Closed', variant: 'outline' },
}

function formatRelativeDate(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60))
      if (diffMins < 1) return 'just now'
      return `${diffMins}m ago`
    }
    return `${diffHours}h ago`
  }
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

interface InboxPostCardProps {
  post: PostListItem
  isSelected: boolean
  onClick: () => void
}

export function InboxPostCard({ post, isSelected, onClick }: InboxPostCardProps) {
  const statusConfig = STATUS_CONFIG[post.status]

  return (
    <Card
      className={cn(
        'p-4 cursor-pointer transition-colors',
        isSelected
          ? 'bg-primary/5 border-primary/20'
          : 'hover:bg-muted/50'
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Vote count */}
        <div className="flex flex-col items-center text-muted-foreground shrink-0 w-8">
          <ChevronUp className="h-4 w-4" />
          <span className="text-sm font-medium">{post.voteCount}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Board & Status */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className="text-xs truncate max-w-[120px]">
              {post.board.name}
            </Badge>
            <Badge variant={statusConfig.variant} className="text-xs">
              {statusConfig.label}
            </Badge>
          </div>

          {/* Title */}
          <h3 className="font-medium text-foreground line-clamp-1">{post.title}</h3>

          {/* Excerpt */}
          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
            {post.content}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>{post.authorName || 'Anonymous'}</span>
            <span>{formatRelativeDate(new Date(post.createdAt))}</span>
            {post.commentCount > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {post.commentCount}
              </span>
            )}
          </div>

          {/* Tags */}
          {post.tags.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {post.tags.slice(0, 3).map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="text-xs"
                  style={{
                    backgroundColor: `${tag.color}20`,
                    color: tag.color,
                    borderColor: `${tag.color}40`,
                  }}
                >
                  {tag.name}
                </Badge>
              ))}
              {post.tags.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{post.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
