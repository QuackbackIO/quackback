/**
 * Left outline rail (support platform §4.6 fullscreen builder): a flat,
 * top-to-bottom list derived from the same tree the canvas renders — the
 * trigger, then each step, with an uppercase section label ("Path A ·
 * Billing") ahead of a branch's paths. Clicking a row selects that node (the
 * canvas scrolls it into view, the inspector shows its editor); a small
 * warning icon flags a step with an unresolved issue.
 */
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import type { OutlineEntry } from '../workflow-graph'
import type { BuilderSelection } from './types'

const KIND_DOT: Record<string, string> = {
  trigger: 'bg-amber-500',
  condition: 'bg-amber-500',
  branch: 'bg-amber-500',
  action: 'bg-emerald-500',
  wait: 'bg-orange-500',
}

export function OutlineRail({
  outline,
  stepCount,
  selection,
  collapsed,
  onSelectNode,
}: {
  outline: OutlineEntry[]
  stepCount: number
  selection: BuilderSelection
  collapsed: boolean
  onSelectNode: (id: string) => void
}) {
  if (collapsed) return null

  return (
    <nav
      aria-label="Workflow outline"
      className="flex w-60 shrink-0 flex-col border-r border-border/50 bg-background"
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Outline
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {stepCount} step{stepCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {outline.map((entry, i) =>
          entry.kind === 'path-header' ? (
            <div
              key={`path-${i}`}
              className="mt-2 mb-1 flex items-center gap-1.5 px-2 text-[10.5px] font-semibold tracking-wide text-muted-foreground/80 uppercase"
              style={{ paddingLeft: `${entry.depth * 12 + 8}px` }}
            >
              {entry.label}
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : (
            <button
              key={entry.id}
              type="button"
              onClick={() => onSelectNode(entry.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs',
                selection?.kind === 'node' && selection.id === entry.id
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-foreground hover:bg-muted/60'
              )}
              style={{ paddingLeft: `${entry.depth * 12 + 8}px` }}
            >
              <span
                className={cn(
                  'size-2 shrink-0 rounded-[2px]',
                  KIND_DOT[entry.kind] ?? 'bg-muted-foreground'
                )}
              />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.hasIssue && (
                <ExclamationTriangleIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
              )}
            </button>
          )
        )}
      </div>
    </nav>
  )
}
