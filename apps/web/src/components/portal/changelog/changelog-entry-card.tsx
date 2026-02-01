'use client'

import { Link } from '@tanstack/react-router'
import { CalendarIcon, LinkIcon } from '@heroicons/react/24/outline'
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
  // Truncate content for preview (strip any basic formatting)
  const contentPreview = content.length > 200 ? content.slice(0, 200).trim() + '...' : content

  const formattedDate = new Date(publishedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <Link
      to="/changelog/$entryId"
      params={{ entryId: id }}
      className={cn(
        'block group rounded-lg border border-border/50 bg-card p-6 hover:border-border hover:shadow-sm transition-all duration-200',
        className
      )}
    >
      {/* Date */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
        <CalendarIcon className="h-4 w-4" />
        <time dateTime={publishedAt}>{formattedDate}</time>
      </div>

      {/* Title */}
      <h2 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
        {title}
      </h2>

      {/* Content preview */}
      <p className="text-muted-foreground text-sm leading-relaxed mb-4">{contentPreview}</p>

      {/* Footer */}
      {linkedPosts.length > 0 && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <LinkIcon className="h-4 w-4" />
          <span>
            {linkedPosts.length} shipped post{linkedPosts.length === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </Link>
  )
}
