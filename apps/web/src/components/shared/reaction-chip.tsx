import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/shared/utils'

/** "Alice", "Alice and Bob", "Alice, Bob and Carol", "Alice, Bob and 5 more". */
function reactorTooltip(reactors: string[] | undefined, count: number): string {
  const names = reactors ?? []
  if (names.length === 0) return count === 1 ? '1 reaction' : `${count} reactions`
  const shown = names.slice(0, 8)
  const hidden = count - shown.length
  if (hidden > 0) return `${shown.join(', ')} and ${hidden} more`
  if (shown.length === 1) return shown[0]
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/**
 * A single reaction pill (emoji + count) shared by conversation messages and feedback
 * comments: toggles the caller's reaction on click and, on hover, shows who
 * reacted with that emoji.
 */
export function ReactionChip({
  emoji,
  count,
  hasReacted,
  reactors,
  onToggle,
  disabled,
}: {
  emoji: string
  count: number
  hasReacted: boolean
  reactors?: string[]
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="reaction-badge"
            aria-pressed={hasReacted}
            onClick={onToggle}
            disabled={disabled}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors',
              hasReacted
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            <span>{emoji}</span>
            <span className="tabular-nums">{count}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-56 text-center">
          {reactorTooltip(reactors, count)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
