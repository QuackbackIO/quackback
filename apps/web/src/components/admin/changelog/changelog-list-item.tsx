'use client'

import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
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

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: '#a1a1aa' }, // zinc-400
  scheduled: { label: 'Scheduled', color: '#3b82f6' }, // blue-500
  published: { label: 'Published', color: '#22c55e' }, // green-500
} as const

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
  const config = STATUS_CONFIG[status]
  const contentPreview = content.length > 150 ? content.slice(0, 150) + '...' : content

  return (
    <div
      className="group relative flex items-start gap-4 p-4 hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={() => onEdit?.(id)}
    >
      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Status badge */}
        <StatusBadge name={config.label} color={config.color} className="mb-1" />

        {/* Title */}
        <h3 className="font-semibold text-base text-foreground line-clamp-1">{title}</h3>

        {/* Content preview */}
        <p className="text-sm text-muted-foreground/60 line-clamp-1 mt-1">{contentPreview}</p>

        {/* Meta row */}
        <div className="flex items-center text-muted-foreground gap-2 text-xs mt-2.5">
          {author && (
            <>
              <span className="text-foreground/80">{author.name}</span>
              <span className="text-muted-foreground/40">·</span>
            </>
          )}
          <span className="text-muted-foreground/70">
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
          {linkedPosts.length > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground/50 ml-auto">
              <LinkIcon className="h-3.5 w-3.5" />
              {linkedPosts.length}
            </span>
          )}
        </div>
      </div>

      {/* Actions dropdown */}
      <div
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-muted/50">
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
    </div>
  )
}
