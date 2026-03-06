import { ChatBubbleLeftIcon, Squares2X2Icon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TimeAgo } from '@/components/ui/time-ago'
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
  return (
    <CreatePostRow suggestion={suggestion} onCreatePost={onCreatePost} onResolved={onResolved} />
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
