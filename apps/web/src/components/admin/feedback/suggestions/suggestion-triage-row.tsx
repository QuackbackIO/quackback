import { HandThumbUpIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { CompactPostCard } from '@/components/shared/compact-post-card'
import { ExpandableQuote } from '@/components/shared/expandable-quote'
import { TimeAgo } from '@/components/ui/time-ago'
import { SourceTypeIcon, SOURCE_TYPE_LABELS } from '../source-type-icon'
import { useSuggestionActions } from './use-suggestion-actions'
import type { SuggestionListItem, SuggestionGroup } from '../feedback-types'

// ─── Group component ────────────────────────────────────────────────

interface SuggestionSourceGroupProps {
  group: SuggestionGroup
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
  onDismissAll: (ids: string[]) => void
}

export function SuggestionSourceGroup({
  group,
  onCreatePost,
  onResolved,
  onDismissAll,
}: SuggestionSourceGroupProps) {
  const rawItem = group.rawItem
  // Derive header info from rawItem when available, otherwise from the first suggestion
  const firstSuggestion = group.suggestions[0]
  const sourceType = rawItem?.sourceType ?? firstSuggestion.rawItem?.sourceType ?? 'api'
  const author = rawItem?.author ?? firstSuggestion.rawItem?.author
  const authorLabel = author?.name ?? author?.email ?? rawItem?.source?.name ?? sourceType
  const headerDate = rawItem?.sourceCreatedAt ?? firstSuggestion.createdAt
  const originalText = rawItem?.content?.text ?? ''
  const allIds = group.suggestions.map((s) => s.id)

  return (
    <div className="w-full px-4 py-3 space-y-2">
      {/* Source header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <SourceTypeIcon sourceType={sourceType} size="sm" />
          <span className="text-[11px] font-medium text-muted-foreground/70">
            {SOURCE_TYPE_LABELS[sourceType] ?? sourceType}
          </span>
          <span className="text-[11px] text-muted-foreground/60 truncate">{authorLabel}</span>
          <TimeAgo date={headerDate} className="text-[11px] text-muted-foreground/40 shrink-0" />
        </div>
        {allIds.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground/50 hover:text-muted-foreground h-7 px-2 text-[11px]"
            onClick={() => onDismissAll(allIds)}
          >
            <XMarkIcon className="h-3 w-3 mr-1" />
            Dismiss all
          </Button>
        )}
      </div>

      {/* Original quote */}
      {originalText && (
        <ExpandableQuote
          text={originalText}
          className="border-l-2 border-muted-foreground/20 pl-2.5 italic"
        />
      )}

      {/* Child suggestions */}
      <div className="space-y-2 pl-1">
        {group.suggestions.map((s) =>
          s.suggestionType === 'vote_on_post' ? (
            <VoteOnPostChild
              key={s.id}
              suggestion={s}
              onCreatePost={onCreatePost}
              onResolved={onResolved}
            />
          ) : (
            <CreatePostChild
              key={s.id}
              suggestion={s}
              onCreatePost={onCreatePost}
              onResolved={onResolved}
            />
          )
        )}
      </div>
    </div>
  )
}

// ─── Child: Create post ─────────────────────────────────────────────

function CreatePostChild({
  suggestion,
  onCreatePost,
  onResolved,
}: {
  suggestion: SuggestionListItem
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
}) {
  const { dismiss, isPending } = useSuggestionActions({
    suggestionId: suggestion.id,
    isMerge: false,
    onResolved,
  })

  const actions = (
    <div className="flex items-center gap-1.5 shrink-0">
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
  )

  return (
    <CompactPostCard
      dashed
      label="Create post"
      title={suggestion.suggestedTitle ?? 'Create post suggestion'}
      voteCount={0}
      boardName={suggestion.board?.name}
      description={suggestion.reasoning}
      actions={actions}
    />
  )
}

// ─── Child: Vote on post ────────────────────────────────────────────

function VoteOnPostChild({
  suggestion,
  onCreatePost,
  onResolved,
}: {
  suggestion: SuggestionListItem
  onCreatePost: (suggestion: SuggestionListItem) => void
  onResolved: () => void
}) {
  const targetPost = suggestion.targetPost
  const { accept, dismiss, isPending } = useSuggestionActions({
    suggestionId: suggestion.id,
    isMerge: false,
    onResolved,
  })

  const similarity = suggestion.similarPosts?.find((p) => p.postId === targetPost?.id)?.similarity
  const similarityLabel = similarity != null ? ` ${Math.round(similarity * 100)}%` : ''

  const actions = (
    <div className="flex items-center gap-1.5 shrink-0">
      <Button size="sm" variant="outline" onClick={() => accept(undefined)} disabled={isPending}>
        <HandThumbUpIcon className="h-3.5 w-3.5 mr-1" />
        Vote
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onCreatePost(suggestion)}
        disabled={isPending}
        className="text-muted-foreground"
      >
        Create instead
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
  )

  if (!targetPost) return null

  return (
    <CompactPostCard
      label={`Vote on post${similarityLabel}`}
      title={targetPost.title}
      voteCount={targetPost.voteCount}
      boardName={targetPost.boardName}
      statusName={targetPost.statusName}
      statusColor={targetPost.statusColor}
      description={suggestion.reasoning}
      actions={actions}
    />
  )
}
