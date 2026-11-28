import { cn } from '@/lib/shared/utils'
import type { CompareView } from './use-portal-editor'

const VIEWS: ReadonlyArray<{ view: CompareView; label: string }> = [
  { view: 'before', label: 'Before' },
  { view: 'after', label: 'After' },
  { view: 'live', label: 'Live' },
]

interface CompareSwitchProps {
  view: CompareView
  /** There is a step before the last change to look back at. */
  canBefore: boolean
  /** The draft differs from what is live. */
  canLive: boolean
  onView: (view: CompareView) => void
}

/**
 * Before, After, Live: which look the preview shows. It never changes the
 * draft; After is the draft itself.
 */
export function CompareSwitch({ view, canBefore, canLive, onView }: CompareSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Compare"
      className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
    >
      {VIEWS.map((option) => {
        const pressed = option.view === view
        const disabled =
          (option.view === 'before' && !canBefore) || (option.view === 'live' && !canLive)
        return (
          <button
            key={option.view}
            type="button"
            aria-pressed={pressed}
            disabled={disabled}
            onClick={() => onView(option.view)}
            className={cn(
              'h-7 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
              pressed
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground enabled:hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

const LABELS: Record<Exclude<CompareView, 'after'>, string> = {
  before: 'Before this change',
  live: 'Live: what visitors see now',
}

/**
 * The label on the preview while it shows anything but the draft, at its foot
 * so it never covers the header being compared. It keeps its own size
 * whatever the frame is scaled to.
 */
export function CompareLabel({ view }: { view: CompareView }) {
  if (view === 'after') return null
  return (
    <div
      className="absolute bottom-4 left-1/2 origin-bottom whitespace-nowrap rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background shadow-md"
      style={{ transform: 'translateX(-50%) scale(calc(1 / var(--preview-scale, 1)))' }}
    >
      {LABELS[view]}
    </div>
  )
}
