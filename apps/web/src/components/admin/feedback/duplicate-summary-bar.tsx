import { useQuery } from '@tanstack/react-query'
import { Square2StackIcon } from '@heroicons/react/24/outline'
import { mergeSuggestionQueries } from '@/lib/client/queries/merge-suggestions'
import { cn } from '@/lib/shared/utils'

interface DuplicateSummaryBarProps {
  active: boolean
  onToggle: () => void
}

/**
 * Shows pending duplicate count from merge suggestions.
 * Clickable to filter the inbox to only posts with duplicates.
 */
export function DuplicateSummaryBar({ active, onToggle }: DuplicateSummaryBarProps) {
  const { data: summary } = useQuery(mergeSuggestionQueries.summary())

  const count = summary?.count ?? 0
  if (count === 0) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
      <Square2StackIcon className="h-4 w-4 text-muted-foreground shrink-0" />
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'px-2 py-0.5 rounded-full transition-colors cursor-pointer',
          active
            ? 'bg-amber-400/20 text-amber-300 font-medium'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        )}
      >
        {count} {count === 1 ? 'duplicate' : 'duplicates'}
      </button>
      {active && (
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer ml-1"
        >
          Clear
        </button>
      )}
    </div>
  )
}
