import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ArrowsRightLeftIcon,
  ChatBubbleLeftIcon,
  ChevronUpIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/solid'
import { ChatBubbleLeftIcon as CommentIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'
import { SourceTypeIcon } from '../source-type-icon'
import { useSuggestionActions } from './use-suggestion-actions'
import type { SuggestionListItem } from '../feedback-types'

interface SuggestionTriageRowProps {
  suggestion: SuggestionListItem
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
}

export function SuggestionTriageRow({
  suggestion,
  onCreatePost,
  onResolved,
}: SuggestionTriageRowProps) {
  const isDuplicate = suggestion.suggestionType === 'duplicate_post'

  if (isDuplicate) {
    return <DuplicateRow suggestion={suggestion} onResolved={onResolved} />
  }

  return (
    <CreatePostRow suggestion={suggestion} onCreatePost={onCreatePost} onResolved={onResolved} />
  )
}

// ─── Duplicate post: side-by-side mini post cards ─────────────────────

function DuplicateRow({
  suggestion,
  onResolved,
}: {
  suggestion: SuggestionListItem
  onResolved: () => void
}) {
  const [swapped, setSwapped] = useState(false)
  const similarity =
    suggestion.similarityScore != null ? Math.round(suggestion.similarityScore * 100) : null

  const { accept, dismiss, isPending } = useSuggestionActions({
    suggestionId: suggestion.id,
    isMerge: true,
    onResolved,
  })

  const leftPost = swapped ? suggestion.targetPost : suggestion.sourcePost
  const rightPost = swapped ? suggestion.sourcePost : suggestion.targetPost

  return (
    <div className="w-full px-4 py-3 space-y-2">
      {/* Header: source */}
      <div className="flex items-center gap-2">
        <SourceTypeIcon sourceType="quackback" size="sm" />
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 shrink-0 border-violet-300/50 text-violet-600 dark:border-violet-700/50 dark:text-violet-400"
        >
          Merge posts
        </Badge>
      </div>

      {/* Side-by-side post cards */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <MiniPostCard post={leftPost} />
        <button
          type="button"
          onClick={() => setSwapped(!swapped)}
          className={cn(
            'flex items-center px-1 py-1 rounded transition-colors cursor-pointer',
            'hover:bg-muted/60 text-muted-foreground/40 hover:text-muted-foreground/70',
            swapped &&
              'text-violet-500 dark:text-violet-400 hover:text-violet-600 dark:hover:text-violet-300'
          )}
          title="Swap merge direction"
        >
          <ArrowsRightLeftIcon className="h-3.5 w-3.5" />
        </button>
        <MiniPostCard post={rightPost} />
      </div>

      {/* Footer: reasoning + match info + actions */}
      <div className="space-y-2">
        {suggestion.reasoning && (
          <p className="text-[11px] text-muted-foreground/50 line-clamp-2 flex items-start gap-1.5">
            <ChatBubbleLeftIcon className="h-3 w-3 shrink-0 mt-0.5" />
            <span>{suggestion.reasoning}</span>
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
            {similarity != null && (
              <span className="font-semibold tabular-nums text-violet-600 dark:text-violet-400">
                {similarity}%
              </span>
            )}
            <span className="text-muted-foreground/40">&middot;</span>
            <TimeAgo date={suggestion.createdAt} className="text-muted-foreground/40" />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => accept(swapped ? { swapDirection: true } : undefined)}
              disabled={isPending}
            >
              Merge
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dismiss()}
              disabled={isPending}
              className="text-muted-foreground"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Compact post card matching the real PostCard layout — clickable to open post modal. */
function MiniPostCard({
  post,
}: {
  post: SuggestionListItem['sourcePost'] | SuggestionListItem['targetPost']
}) {
  const navigate = useNavigate()

  if (!post) return <div className="min-w-0" />

  const handleClick = () => {
    navigate({
      to: '/admin/feedback/suggestions',
      search: (prev: Record<string, unknown>) => ({ ...prev, post: post.id }),
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="min-w-0 rounded-md border border-border/60 bg-muted/30 p-2.5 text-left cursor-pointer transition-colors hover:bg-muted/50 hover:border-border"
    >
      <div className="flex items-start gap-2.5">
        {/* Vote pill */}
        <div className="flex flex-col items-center shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-1 gap-0">
          <ChevronUpIcon className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-semibold tabular-nums text-foreground">
            {post.voteCount}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {post.statusName && (
            <StatusBadge
              name={post.statusName}
              color={post.statusColor}
              className="text-[10px] mb-0.5"
            />
          )}
          <p className="text-sm font-semibold text-foreground line-clamp-1">{post.title}</p>
          {post.content && (
            <p className="text-xs text-muted-foreground/60 line-clamp-1 mt-0.5">{post.content}</p>
          )}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 mt-1.5">
            {post.boardName && (
              <>
                <Squares2X2Icon className="h-3 w-3 shrink-0 text-muted-foreground/40 -mr-1 mb-0.5" />
                <span className="truncate">{post.boardName}</span>
              </>
            )}
            {post.createdAt && (
              <>
                {post.boardName && <span className="text-muted-foreground/30">&middot;</span>}
                <TimeAgo date={post.createdAt} className="shrink-0" />
              </>
            )}
            {(post.commentCount ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 ml-auto shrink-0">
                <CommentIcon className="h-3 w-3" />
                {post.commentCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Create post: original layout ─────────────────────────────────────

function CreatePostRow({
  suggestion,
  onCreatePost,
  onResolved,
}: {
  suggestion: SuggestionListItem
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
}) {
  const rawItem = suggestion.rawItem
  const content = rawItem?.content
  const author = rawItem?.author
  const sourceType = rawItem?.sourceType ?? 'api'
  const originalText = content?.text ?? ''

  const { dismiss, isPending } = useSuggestionActions({
    suggestionId: suggestion.id,
    isMerge: false,
    onResolved,
  })

  return (
    <div className="w-full px-4 py-3 space-y-2.5">
      {/* Header: source icon + type badge + author + time */}
      <div className="flex items-center gap-2">
        <SourceTypeIcon sourceType={sourceType} size="sm" />
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 shrink-0 border-emerald-300/50 text-emerald-600 dark:border-emerald-700/50 dark:text-emerald-400"
        >
          Create post
        </Badge>
        <span className="text-[11px] text-muted-foreground/60 truncate">
          {author?.name ?? author?.email ?? rawItem?.source?.name ?? sourceType}
        </span>
        <TimeAgo
          date={suggestion.createdAt}
          className="text-[11px] text-muted-foreground/40 shrink-0"
        />
      </div>

      {/* Original feedback quote */}
      {originalText && (
        <p className="text-xs text-muted-foreground/70 line-clamp-2 border-l-2 border-muted-foreground/20 pl-2.5 italic">
          {originalText}
        </p>
      )}

      {/* AI-derived title + reasoning */}
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground leading-snug">
          {suggestion.suggestedTitle ?? 'Create post suggestion'}
        </p>
        {suggestion.reasoning && (
          <p className="text-[11px] text-muted-foreground/50 line-clamp-1 flex items-center gap-1.5 mt-1">
            <ChatBubbleLeftIcon className="h-3 w-3 shrink-0" />
            {suggestion.reasoning}
          </p>
        )}
      </div>

      {/* Footer: board + actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          {suggestion.board && (
            <Badge variant="outline" className="text-[10px] inline-flex items-center gap-0.5">
              <Squares2X2Icon className="h-3 w-3 text-muted-foreground/40" />
              {suggestion.board.name}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onCreatePost(suggestion)}
            disabled={isPending}
          >
            Create post
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => dismiss()}
            disabled={isPending}
            className="text-muted-foreground"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  )
}
