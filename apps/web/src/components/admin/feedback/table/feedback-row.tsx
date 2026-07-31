import { PostCard } from '@/components/public/post-card'
import { Checkbox } from '@/components/ui/checkbox'
import { Square2StackIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import type { PostListItem, PostStatusEntity } from '@/lib/shared/db-types'

interface FeedbackRowProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  duplicateCount?: number
  onClick: () => void
  /** Multi-select state for the bulk-action toolbar. */
  selected?: boolean
  /** True once any row is selected — keeps every row's checkbox visible. */
  selectionActive?: boolean
  onSelectChange?: (selected: boolean) => void
}

export function FeedbackRow({
  post,
  statuses,
  duplicateCount,
  onClick,
  selected = false,
  selectionActive = false,
  onSelectChange,
}: FeedbackRowProps) {
  return (
    <div className="group relative flex items-center">
      {/* Selection gutter: reserves its width for every row so the cards stay
          aligned whether or not a selection is active; the checkbox itself
          appears on hover and stays visible while a selection is active. */}
      <div
        className={cn(
          'flex items-center pl-3 pr-1 self-stretch transition-opacity',
          selectionActive || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelectChange?.(checked === true)}
          aria-label={`Select ${post.title}`}
        />
      </div>
      <div className="relative flex-1 min-w-0">
        <PostCard
          // Core post data
          id={post.id}
          title={post.title}
          content={post.content}
          statusId={post.statusId}
          statuses={statuses}
          voteCount={post.voteCount}
          commentCount={post.commentCount}
          authorName={post.authorName}
          createdAt={post.createdAt}
          boardSlug={post.board.slug}
          tags={post.tags}
          // Admin mode - click to open modal
          onClick={onClick}
          // Admin doesn't need avatars in list view
          showAvatar={false}
        />
        {duplicateCount != null && duplicateCount > 0 && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium border text-muted-foreground bg-muted/40 border-border/40">
            <Square2StackIcon className="h-3.5 w-3.5" />
            {duplicateCount === 1 ? '1 duplicate' : `${duplicateCount} duplicates`}
          </span>
        )}
      </div>
    </div>
  )
}
