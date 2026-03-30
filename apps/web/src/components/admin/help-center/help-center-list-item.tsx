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
import { EllipsisHorizontalIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { HelpCenterArticleId } from '@quackback/ids'
import { stripMarkdownPreview } from '@/lib/shared/utils'

interface HelpCenterListItemProps {
  id: HelpCenterArticleId
  title: string
  content: string
  publishedAt: string | null
  createdAt: string
  category: { id: string; slug: string; name: string }
  author: { id: string; name: string; avatarUrl: string | null } | null
  viewCount: number
  helpfulCount: number
  onEdit?: (id: HelpCenterArticleId) => void
  onDelete?: (id: HelpCenterArticleId) => void
}

export function HelpCenterListItem({
  id,
  title,
  content,
  publishedAt,
  createdAt,
  category,
  author,
  viewCount,
  helpfulCount,
  onEdit,
  onDelete,
}: HelpCenterListItemProps) {
  const isPublished = !!publishedAt
  const statusConfig = isPublished
    ? { label: 'Published', color: '#22c55e' }
    : { label: 'Draft', color: '#a1a1aa' }

  const contentPreview = stripMarkdownPreview(content)

  return (
    <div
      className="group relative flex items-start gap-4 p-4 hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={() => onEdit?.(id)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <StatusBadge name={statusConfig.label} color={statusConfig.color} />
          <span className="text-[10px] text-muted-foreground/50 font-medium">{category.name}</span>
        </div>

        <h3 className="font-semibold text-base text-foreground line-clamp-1">{title}</h3>
        <p className="text-sm text-muted-foreground/60 line-clamp-1 mt-1">{contentPreview}</p>

        <div className="flex items-center text-muted-foreground gap-2 text-xs mt-2.5">
          {author && (
            <>
              <span className="text-foreground/80">{author.name}</span>
              <span className="text-muted-foreground/40">&middot;</span>
            </>
          )}
          <span className="text-muted-foreground/70">
            {isPublished ? (
              <>
                Published <TimeAgo date={publishedAt!} />
              </>
            ) : (
              <>
                Created <TimeAgo date={createdAt} />
              </>
            )}
          </span>
          {viewCount > 0 && (
            <>
              <span className="text-muted-foreground/40">&middot;</span>
              <span className="text-muted-foreground/50">{viewCount} views</span>
            </>
          )}
          {helpfulCount > 0 && (
            <>
              <span className="text-muted-foreground/40">&middot;</span>
              <span className="text-muted-foreground/50">{helpfulCount} helpful</span>
            </>
          )}
        </div>
      </div>

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
