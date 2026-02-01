import { useState } from 'react'
import { PostCard } from '@/components/public/post-card'
import type { PostListItem, PostStatusEntity } from '@/lib/shared/db-types'
import type { StatusId } from '@quackback/ids'

interface FeedbackRowProps {
  post: PostListItem
  statuses: PostStatusEntity[]
  isFocused: boolean
  onClick: () => void
  onStatusChange: (statusId: StatusId) => void
}

export function FeedbackRow({
  post,
  statuses,
  isFocused,
  onClick,
  onStatusChange,
}: FeedbackRowProps) {
  const [isHovered, setIsHovered] = useState(false)

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
      // Admin mode
      canChangeStatus
      onStatusChange={onStatusChange}
      isFocused={isFocused}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      showQuickActions={isHovered || isFocused}
      // Admin doesn't need avatars in list view
      showAvatar={false}
    />
  )
}
