import { PostCard } from '@/components/public/post-card'
import type { PostListItem, PostStatusEntity } from '@/lib/shared/db-types'

interface FeedbackRowProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  onClick: () => void
}

export function FeedbackRow({ post, statuses, onClick }: FeedbackRowProps) {
  return (
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
      boardName={post.board.name}
      tags={post.tags}
      // Admin mode - click to open modal
      onClick={onClick}
      // Admin doesn't need avatars in list view
      showAvatar={false}
    />
  )
}
