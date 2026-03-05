import { PostCard } from '@/components/public/post-card'
import { SignalBadges } from '@/components/admin/feedback/signal-badges'
import type { PostListItem, PostStatusEntity } from '@/lib/shared/db-types'
import type { PostSignalCounts } from '@/lib/server/domains/signals'

interface FeedbackRowProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  signals?: PostSignalCounts[]
  onClick: () => void
}

export function FeedbackRow({ post, statuses, signals, onClick }: FeedbackRowProps) {
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
      {signals && signals.length > 0 && (
        <SignalBadges
          signals={signals}
          className="absolute top-3 right-3"
        />
      )}
    </div>
  )
}
