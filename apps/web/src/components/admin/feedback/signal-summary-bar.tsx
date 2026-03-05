import { useQuery } from '@tanstack/react-query'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { signalQueries } from '@/lib/client/queries/signals'
import { SIGNAL_DISPLAY } from '@/components/admin/feedback/signal-config'
import { cn } from '@/lib/shared/utils'
import type { AiSignalType } from '@/lib/server/domains/signals'

interface SignalSummaryBarProps {
  activeSignalFilter?: AiSignalType
  onSignalFilter: (type: AiSignalType | undefined) => void
}

/**
 * Signal summary bar showing counts by type.
 * Each count is clickable to filter the inbox by that signal type.
 */
export function SignalSummaryBar({ activeSignalFilter, onSignalFilter }: SignalSummaryBarProps) {
  const { data: summary } = useQuery(signalQueries.summary())

  if (!summary || summary.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
      <SparklesIcon className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      <div className="flex items-center gap-1.5 flex-wrap">
        {summary.map((signal) => {
          const config = SIGNAL_DISPLAY[signal.type]
          const label = signal.count === 1 ? config.singularLabel : config.pluralLabel
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
