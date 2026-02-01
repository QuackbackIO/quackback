'use client'

import { Link } from '@tanstack/react-router'
import { LinkIcon } from '@heroicons/react/24/outline'
import type { ChangelogId, PostId } from '@quackback/ids'
import { cn } from '@/lib/shared/utils'

interface ChangelogEntryCardProps {
  id: ChangelogId
  title: string
  content: string
  publishedAt: string
  linkedPosts: Array<{
    id: PostId
    title: string
    voteCount: number
    boardSlug: string
  }>
  className?: string
}

export function ChangelogEntryCard({
  id,
  title,
  content,
  publishedAt,
  linkedPosts,
  className,
}: ChangelogEntryCardProps) {
  // Truncate content for preview
  const contentPreview = content.length > 280 ? content.slice(0, 280).trim() + '...' : content

  const date = new Date(publishedAt)
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  const day = date.getDate()
  const year = date.getFullYear()

  return (
    <Link
      to="/changelog/$entryId"
      params={{ entryId: id }}
      className={cn('group block', className)}
    >
      <article className="flex gap-6 py-6 border-b border-border/50">
        {/* Date sidebar */}
        <div className="hidden sm:flex flex-col items-center w-16 shrink-0 pt-1">
          <span className="text-2xl font-bold text-foreground">{day}</span>
          <span className="text-sm text-muted-foreground uppercase tracking-wide">{month}</span>
          <span className="text-xs text-muted-foreground">{year}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Mobile date */}
          <time
            dateTime={publishedAt}
            className="sm:hidden text-sm text-muted-foreground mb-2 block"
          >
            {month} {day}, {year}
          </time>

          {/* Title */}
          <h2 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
            {title}
          </h2>

          {/* Content preview */}
          <p className="text-muted-foreground text-sm leading-relaxed">{contentPreview}</p>

          {/* Linked posts count */}
          {linkedPosts.length > 0 && (
            <div className="flex items-center gap-1.5 mt-3 text-sm text-muted-foreground">
              <LinkIcon className="h-3.5 w-3.5" />
              <span>
                {linkedPosts.length} linked feature{linkedPosts.length === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
      </article>
    </Link>
  )
}
