import { useState } from 'react'
import { PostListItem } from '@/components/shared/post-list-item'
import { RowQuickActions } from './row-quick-actions'
import type { PostListItem as PostListItemType, PostStatusEntity } from '@/lib/db-types'
import type { StatusId } from '@quackback/ids'

interface FeedbackRowProps {
  post: PostListItemType
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
  const currentStatus = statuses.find((s) => s.id === post.statusId)

  return (
    <PostListItem
      post={{
        id: post.id,
        title: post.title,
        content: post.content,
        statusId: post.statusId,
        voteCount: post.voteCount,
        commentCount: post.commentCount,
        authorName: post.authorName,
        createdAt: post.createdAt,
        boardSlug: post.board.slug,
        boardName: post.board.name,
        tags: post.tags,
      }}
      statuses={statuses}
      isFocused={isFocused}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      showAvatar={false}
      renderQuickActions={
        isHovered || isFocused
          ? () => (
              <RowQuickActions
                post={post}
                statuses={statuses}
                currentStatus={currentStatus}
                onStatusChange={onStatusChange}
              />
            )
          : undefined
      }
    />
  )
}
