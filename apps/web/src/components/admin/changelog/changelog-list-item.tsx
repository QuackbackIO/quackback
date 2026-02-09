'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  EllipsisHorizontalIcon,
  PencilIcon,
  TrashIcon,
  LinkIcon,
} from '@heroicons/react/24/outline'
import type { ChangelogId, PrincipalId, PostId } from '@quackback/ids'
import { cn } from '@/lib/shared/utils'

interface ChangelogListItemProps {
  id: ChangelogId
  title: string
  content: string
  status: 'draft' | 'scheduled' | 'published'
  publishedAt: string | null
  createdAt: string
  author: {
    id: PrincipalId
    name: string
    avatarUrl: string | null
  } | null
  linkedPosts: Array<{
    id: PostId
    title: string
    voteCount: number
  }>
  onEdit?: (id: ChangelogId) => void
  onDelete?: (id: ChangelogId) => void
}

export function ChangelogListItem({
  id,
  title,
  content,
  status,
  publishedAt,
  createdAt,
  author,
  linkedPosts,
  onEdit,
  onDelete,
}: ChangelogListItemProps) {
  const statusConfig = {
    draft: {
      label: 'Draft',
      variant: 'secondary' as const,
      className: 'bg-muted text-muted-foreground',
    },
    scheduled: {
      label: 'Scheduled',
      variant: 'secondary' as const,
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    published: {
      label: 'Published',
      variant: 'secondary' as const,
      className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    },
  }

  const config = statusConfig[status]

  // Truncate content for preview
  const contentPreview = content.length > 150 ? content.slice(0, 150) + '...' : content

  const handleRowClick = () => {
    onEdit?.(id)
  }

  return (
    <div
      className="group relative flex items-start gap-4 p-4 hover:bg-muted/30 transition-colors border-b last:border-b-0 cursor-pointer"
      onClick={handleRowClick}
    >
      {/* Author avatar */}
      <Avatar className="h-8 w-8 shrink-0" src={author?.avatarUrl} name={author?.name} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium text-sm truncate">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{contentPreview}</p>
          </div>

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <EllipsisHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit?.(id)}>
                <PencilIcon className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete?.(id)}
                className="text-destructive focus:text-destructive"
              >
                <TrashIcon className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Meta info */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <Badge variant={config.variant} className={cn('text-xs font-normal', config.className)}>
            {config.label}
          </Badge>

          {linkedPosts.length > 0 && (
            <span className="flex items-center text-xs text-muted-foreground">
              <LinkIcon className="h-3 w-3 mr-1" />
              {linkedPosts.length} post{linkedPosts.length === 1 ? '' : 's'}
            </span>
          )}

          <span className="text-xs text-muted-foreground">
            {status === 'published' && publishedAt ? (
              <>
                Published <TimeAgo date={publishedAt} />
              </>
            ) : status === 'scheduled' && publishedAt ? (
              <>
                Scheduled for{' '}
                {new Date(publishedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </>
            ) : (
              <>
                Created <TimeAgo date={createdAt} />
              </>
            )}
          </span>

          {author && <span className="text-xs text-muted-foreground">by {author.name}</span>}
        </div>
      </div>
    </div>
  )
}
