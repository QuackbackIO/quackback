import { cn } from '@/lib/shared/utils'
import { WORDS } from './properties/words'

/** The column a narrow window shows: Ask AI, the page, or the properties beside it. */
export type Pane = 'ai' | 'page' | 'settings'

const PANES: Array<[Pane, string]> = [
  ['ai', 'Ask AI'],
  ['page', 'Page'],
  ['settings', WORDS.properties],
]

/**
 * In a narrow window one column shows at a time, picked here. Properties is
 * always there: with nothing picked it holds the page's own panel.
 */
export function BuilderColumns({ pane, onPane }: { pane: Pane; onPane: (pane: Pane) => void }) {
  return (
    <nav
      aria-label="Builder columns"
      className="flex shrink-0 gap-1 border-b border-border bg-background p-2 min-[1100px]:hidden"
    >
      {PANES.map(([key, name]) => (
        <button
          key={key}
          type="button"
          aria-pressed={pane === key}
          onClick={() => onPane(key)}
          className={cn(
            'flex-1 rounded-md px-3 py-1.5 text-sm',
            pane === key ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'
          )}
        >
          {name}
        </button>
      ))}
    </nav>
  )
}
