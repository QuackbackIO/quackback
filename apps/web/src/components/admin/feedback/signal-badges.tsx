import { cn } from '@/lib/shared/utils'
import { SIGNAL_DISPLAY } from '@/components/admin/feedback/signal-config'
import type { PostSignalCounts } from '@/lib/server/domains/signals'

interface SignalBadgesProps {
  signals: PostSignalCounts[]
  className?: string
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
        const config = SIGNAL_DISPLAY[signal.type]
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
            {config.badgeLabel(signal.count)}
          </span>
        )
      })}
      {overflow > 0 && (
        <span className="text-[10px] text-muted-foreground">+{overflow}</span>
      )}
    </div>
  )
}
