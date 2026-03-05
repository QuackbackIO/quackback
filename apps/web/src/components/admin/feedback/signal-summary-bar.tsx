import { useQuery } from '@tanstack/react-query'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { signalQueries } from '@/lib/client/queries/signals'
import { cn } from '@/lib/shared/utils'

interface SignalSummaryBarProps {
  activeSignalFilter?: string
  onSignalFilter: (type: string | undefined) => void
}

const SIGNAL_LABELS: Record<string, { singular: string; plural: string }> = {
  duplicate: { singular: 'duplicate', plural: 'duplicates' },
  sentiment: { singular: 'urgent', plural: 'urgent' },
  categorize: { singular: 'uncategorized', plural: 'uncategorized' },
  trend: { singular: 'trending', plural: 'trending' },
  response_draft: { singular: 'needs response', plural: 'need response' },
}

/**
 * Signal summary bar showing counts by type.
 * Each count is clickable to filter the inbox by that signal type.
 */
export function SignalSummaryBar({ activeSignalFilter, onSignalFilter }: SignalSummaryBarProps) {
  const { data: summary } = useQuery(signalQueries.summary())

  if (!summary || summary.length === 0) return null

  const totalCount = summary.reduce((sum, s) => sum + s.count, 0)
  if (totalCount === 0) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
      <SparklesIcon className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      <div className="flex items-center gap-1.5 flex-wrap">
        {summary.map((signal) => {
          const labels = SIGNAL_LABELS[signal.type]
          if (!labels) return null
          const label = signal.count === 1 ? labels.singular : labels.plural
          const isActive = activeSignalFilter === signal.type

          return (
            <button
              key={signal.type}
              type="button"
              onClick={() => onSignalFilter(isActive ? undefined : signal.type)}
              className={cn(
                'px-2 py-0.5 rounded-full transition-colors cursor-pointer',
                isActive
                  ? 'bg-amber-400/20 text-amber-300 font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              {signal.count} {label}
            </button>
          )
        })}
        {activeSignalFilter && (
          <button
            type="button"
            onClick={() => onSignalFilter(undefined)}
            className="text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer ml-1"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
