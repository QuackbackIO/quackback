/**
 * Lane tabs at a fork: one path is visible; the others sit behind a tab
 * showing the branch label and how many steps it holds. Active lane is
 * parent state only — never persisted.
 */
import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import type { ForkLane } from './tree-walk'

export function LaneTabs({
  lanes,
  activeKey,
  onChange,
}: {
  lanes: ForkLane[]
  activeKey: string
  onChange: (key: string) => void
}) {
  const intl = useIntl()
  return (
    <div
      role="tablist"
      aria-label={intl.formatMessage({
        id: 'automation.builder.branchPaths',
        defaultMessage: 'Branch paths',
      })}
      className="flex flex-wrap justify-center gap-1.5"
    >
      {lanes.map((lane) => {
        const selected = lane.key === activeKey
        const countLabel = intl.formatMessage(
          {
            id: 'automation.builder.laneSteps',
            defaultMessage: '{count, plural, one {# step} other {# steps}}',
          },
          { count: lane.stepCount }
        )
        return (
          <button
            key={lane.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(lane.key)}
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              selected
                ? 'border-foreground/15 bg-foreground text-background'
                : 'border-border bg-muted/60 text-muted-foreground hover:text-foreground'
            )}
          >
            <span className="truncate">{lane.label}</span>
            <span className={cn('shrink-0 tabular-nums', selected ? 'opacity-80' : 'opacity-70')}>
              {countLabel}
            </span>
          </button>
        )
      })}
    </div>
  )
}
