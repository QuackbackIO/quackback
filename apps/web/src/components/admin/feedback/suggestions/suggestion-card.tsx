import { ArrowRightIcon } from '@heroicons/react/24/solid'
import { Badge } from '@/components/ui/badge'
import { SourceTypeIcon } from '../source-type-icon'
import { cn } from '@/lib/shared/utils'
import type { SuggestionListItem } from '../feedback-types'

interface SuggestionCardProps {
  suggestion: SuggestionListItem
  isSelected: boolean
  onClick: () => void
}

function timeAgo(date: string | Date): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const seconds = Math.floor((now - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function SuggestionCard({ suggestion, isSelected, onClick }: SuggestionCardProps) {
  const isMerge = suggestion.suggestionType === 'merge_post'
  const sourceType = suggestion.rawItem?.sourceType ?? 'api'
  const content = suggestion.rawItem?.content
  const title = isMerge
    ? (content?.subject ?? suggestion.signal?.summary ?? 'Feedback')
    : (suggestion.suggestedTitle ?? 'New post suggestion')
  const similarity =
    suggestion.similarityScore != null ? Math.round(suggestion.similarityScore * 100) : null

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-3 transition-all duration-150',
        'hover:bg-muted/40',
        isSelected && 'bg-primary/[0.04] border-l-2 border-l-primary',
        !isSelected && 'border-l-2 border-l-transparent'
      )}
    >
      <div className="grid grid-cols-[28px_1fr_auto] gap-2.5 items-start">
        {/* Source icon */}
        <SourceTypeIcon sourceType={sourceType} size="sm" className="mt-0.5" />

        {/* Content */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge
              variant={isMerge ? 'outline' : 'secondary'}
              className={cn(
                'text-[10px] px-1.5 py-0',
                isMerge
                  ? 'border-blue-300/50 text-blue-600 dark:border-blue-700/50 dark:text-blue-400'
                  : 'border-emerald-300/50 text-emerald-600 dark:border-emerald-700/50 dark:text-emerald-400'
              )}
            >
              {isMerge ? 'Merge' : 'New post'}
            </Badge>
            <span className="text-[10px] text-muted-foreground/60">
              {timeAgo(suggestion.createdAt)}
            </span>
          </div>

          <p className="text-sm font-medium text-foreground truncate leading-snug">{title}</p>

          {isMerge && suggestion.targetPost && (
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground/80">
              <ArrowRightIcon className="h-3 w-3 shrink-0 text-blue-500/70" />
              <span className="truncate">{suggestion.targetPost.title}</span>
            </div>
          )}

          {!isMerge && suggestion.board && (
            <p className="mt-1 text-xs text-muted-foreground/60 truncate">
              {suggestion.board.name}
            </p>
          )}
        </div>

        {/* Similarity meter (merge suggestions only) */}
        {isMerge && similarity != null && (
          <div className="flex flex-col items-end gap-0.5 pt-1">
            <span className="text-[10px] font-medium tabular-nums text-blue-600 dark:text-blue-400">
              {similarity}%
            </span>
            <div className="w-10 h-1 rounded-full bg-blue-100 dark:bg-blue-900/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500/80"
                style={{ width: `${similarity}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </button>
  )
}
