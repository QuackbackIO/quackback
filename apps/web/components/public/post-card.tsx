'use client'

import Link from 'next/link'
import { ChevronUp, MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import { usePostVote } from '@/lib/hooks/use-post-vote'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { getInitials } from '@quackback/domain/utils'
import type { PostStatusEntity } from '@/lib/db/types'
import type { StatusId } from '@quackback/ids'

interface PostCardProps {
  id: string
  title: string
  content: string
  statusId: StatusId | null
  statuses: PostStatusEntity[]
  voteCount: number
  commentCount: number
  authorName: string | null
  /** Avatar URL for the author (base64 data URL or external URL) */
  authorAvatarUrl?: string | null
  createdAt: Date
  boardSlug: string
  boardName?: string
  tags: { id: string; name: string; color: string }[]
  hasVoted?: boolean
  /** Callback when vote state changes (postId, newVotedState) */
  onVoteChange?: (postId: string, voted: boolean) => void
  /** Whether the user is authenticated (shows login dialog on vote if false) */
  isAuthenticated?: boolean
}

export function PostCard({
  id,
  title,
  content,
  statusId,
  statuses,
  voteCount,
  commentCount,
  authorName,
  authorAvatarUrl,
  createdAt,
  boardSlug,
  boardName,
  tags,
  hasVoted = false,
  onVoteChange,
  isAuthenticated = true,
}: PostCardProps) {
  const { openAuthPopover } = useAuthPopover()
  const currentStatus = statuses.find((s) => s.id === statusId)
  const {
    voteCount: currentVoteCount,
    hasVoted: currentHasVoted,
    isPending,
    handleVote,
  } = usePostVote({
    postId: id,
    initialVoteCount: voteCount,
    initialHasVoted: hasVoted,
    onVoteChange,
  })

  return (
    <Link
      href={`/b/${boardSlug}/posts/${id}`}
      className="post-card flex transition-colors bg-[var(--post-card-background)] hover:bg-[var(--post-card-background)]/80"
    >
      {/* Vote section - left column */}
      <button
        type="button"
        data-testid="vote-button"
        aria-label={
          currentHasVoted
            ? `Remove vote (${currentVoteCount} votes)`
            : `Vote for this post (${currentVoteCount} votes)`
        }
        aria-pressed={currentHasVoted}
        onClick={(e) => {
          if (!isAuthenticated) {
            e.preventDefault()
            e.stopPropagation()
            openAuthPopover({ mode: 'login' })
            return
          }
          handleVote(e)
        }}
        disabled={isPending}
        className={`post-card__vote flex flex-col items-center justify-center w-16 shrink-0 border-r border-[var(--post-card-border)]/30 hover:bg-muted/40 transition-colors ${
          currentHasVoted
            ? 'post-card__vote--voted text-[var(--post-card-voted-color)]'
            : 'text-muted-foreground'
        } ${isPending ? 'opacity-70' : ''}`}
      >
        <ChevronUp
          className={`h-5 w-5 ${currentHasVoted ? 'fill-[var(--post-card-voted-color)]' : ''}`}
        />
        <span
          data-testid="vote-count"
          className={`text-sm font-bold ${currentHasVoted ? '' : 'text-foreground'}`}
        >
          {currentVoteCount}
        </span>
      </button>

      {/* Content section */}
      <div className="post-card__content flex-1 min-w-0 px-4 py-3">
        {/* Status badge - only render if status exists */}
        {currentStatus && (
          <StatusBadge name={currentStatus.name} color={currentStatus.color} className="mb-2" />
        )}

        {/* Title */}
        <h3 className="font-semibold text-[15px] text-foreground line-clamp-1 mb-1">{title}</h3>

        {/* Description */}
        <p className="text-sm text-muted-foreground/80 line-clamp-2 mb-2">{content}</p>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex gap-1.5 mb-3 flex-wrap">
            {tags.slice(0, 3).map((tag) => (
              <Badge key={tag.id} variant="secondary" className="text-[11px] font-normal">
                {tag.name}
              </Badge>
            ))}
            {tags.length > 3 && (
              <span className="text-[11px] text-muted-foreground">+{tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <Avatar className="h-5 w-5">
            {authorAvatarUrl && <AvatarImage src={authorAvatarUrl} alt={authorName || 'Author'} />}
            <AvatarFallback className="text-[10px] bg-muted">
              {getInitials(authorName)}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium text-foreground/90">{authorName || 'Anonymous'}</span>
          <span className="text-muted-foreground">·</span>
          <TimeAgo date={createdAt} />
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-muted-foreground/70">
            <MessageSquare className="h-3.5 w-3.5" />
            <span>{commentCount}</span>
          </div>
          {boardName && (
            <Badge variant="secondary" className="text-[11px] font-normal bg-muted/50">
              {boardName}
            </Badge>
          )}
        </div>
      </div>
    </Link>
  )
}
