import { PostCard } from '@/components/public/post-card'
import { Square2StackIcon } from '@heroicons/react/24/outline'
import type { PostListItem, PostStatusEntity } from '@/lib/shared/db-types'

interface FeedbackRowProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  duplicateCount?: number
  onClick: () => void
}

export function FeedbackRow({ post, statuses, duplicateCount, onClick }: FeedbackRowProps) {
  return (
    <div className="relative">
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
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border text-muted-foreground bg-muted/40 border-border/40">
          <Square2StackIcon className="h-3.5 w-3.5" />
          {duplicateCount === 1 ? '1 duplicate' : `${duplicateCount} duplicates`}
        </span>
      )}
    </div>
  )
}
