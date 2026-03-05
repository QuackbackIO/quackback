import { SparklesIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import type { PostSignalCounts } from '@/lib/server/domains/signals'

interface SignalBadgesProps {
  signals: PostSignalCounts[]
  className?: string
}

const SIGNAL_CONFIG: Record<
  string,
  { label: (count: number) => string; icon: typeof SparklesIcon; className: string }
> = {
  duplicate: {
    label: (n) => (n === 1 ? '1 duplicate' : `${n} duplicates`),
    icon: SparklesIcon,
    className: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  },
  sentiment: {
    label: () => 'Urgent',
    icon: ExclamationTriangleIcon,
    className: 'text-red-400 bg-red-400/10 border-red-400/20',
  },
  categorize: {
    label: () => 'Uncategorized',
    icon: SparklesIcon,
    className: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  },
  trend: {
    label: () => 'Trending',
    icon: SparklesIcon,
    className: 'text-green-400 bg-green-400/10 border-green-400/20',
  },
  response_draft: {
    label: () => 'Draft ready',
    icon: SparklesIcon,
    className: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
  },
}

/**
 * Renders small signal chips next to a post row.
 * Shows at most 2 badges, with severity-based priority (urgent first).
 */
export function SignalBadges({ signals, className }: SignalBadgesProps) {
  if (signals.length === 0) return null

  // Sort: urgent severity first, then by count descending
  const sorted = [...signals].sort((a, b) => {
    const severityOrder = { urgent: 0, warning: 1, info: 2 }
    const aSev = severityOrder[a.severity] ?? 2
    const bSev = severityOrder[b.severity] ?? 2
    if (aSev !== bSev) return aSev - bSev
    return b.count - a.count
  })

  const visible = sorted.slice(0, 2)
  const overflow = sorted.length - 2

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {visible.map((signal) => {
        const config = SIGNAL_CONFIG[signal.type]
        if (!config) return null
        const Icon = config.icon
        return (
          <span
            key={signal.type}
            className={cn(
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border',
              config.className
            )}
          >
            <Icon className="h-3 w-3" />
            {config.label(signal.count)}
          </span>
        )
      })}
      {overflow > 0 && (
        <span className="text-[10px] text-muted-foreground">+{overflow}</span>
      )}
    </div>
  )
}
