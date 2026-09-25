import { memo } from 'react'
import { PostCard } from '@/components/public/post-card'
import { Square2StackIcon } from '@heroicons/react/24/outline'
import type { PostListItem, PostStatusEntity } from '@/lib/shared/db-types'

interface FeedbackRowProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  duplicateCount?: number
  /** Opens a post; stable across renders so the row renders only for its own post. */
  onOpen: (postId: string) => void
}

/**
 * Memoized: every prop is stable while the row's post is unchanged, so a
 * keystroke in the search box or a URL change around the list renders no row.
 */
export const FeedbackRow = memo(function FeedbackRow({
  post,
  statuses,
  duplicateCount,
  onOpen,
}: FeedbackRowProps) {
  return (
    <div className="group relative flex items-center">
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
          onClick={() => onOpen(post.id)}
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
})
