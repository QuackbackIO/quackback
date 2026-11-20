import type { ReactNode } from 'react'
import { CheckCircleIcon, InformationCircleIcon } from '@heroicons/react/24/solid'
import { Progress } from '@/components/ui/progress'
import { PLAN_CAP_LABELS } from '@/lib/shared/billing/plan-limits-copy'
import { cn } from '@/lib/shared/utils'

/**
 * One row of the plan limits list. `over` needs a fix, `fixed` was over and
 * fits now, `info` is over but needs nothing (existing items stay).
 */
export interface PlanLimitRow {
  key: keyof typeof PLAN_CAP_LABELS
  used: number
  cap: number
  status: 'over' | 'fixed' | 'info'
  /** What happens, or happened, to the excess. */
  note?: string
  /** The fixes this viewer can make: chooser buttons, a link to manage the resource. */
  actions?: ReactNode
}

/**
 * The list of caps a workspace is over, shared by the Plan limits page, the
 * downgrade dialog and the ended-trial view so they always show the same rows
 * the same way. Every row stacks the same four lines (name and count, a
 * full-width bar, one muted sentence, the actions), so the bars line up and
 * the sentences read in one or two lines.
 */
export function PlanLimitIssues(props: { rows: PlanLimitRow[]; className?: string }) {
  if (props.rows.length === 0) return null
  return (
    <ul
      data-plan-limit-issues=""
      className={cn(
        'divide-y divide-border/50 overflow-hidden rounded-xl border bg-card',
        props.className
      )}
    >
      {props.rows.map((row) => (
        <PlanLimitIssueRow key={row.key} row={row} />
      ))}
    </ul>
  )
}

function PlanLimitIssueRow({ row }: { row: PlanLimitRow }) {
  const label = PLAN_CAP_LABELS[row.key]
  const over = row.status === 'over'
  return (
    <li
      data-plan-limit-row={row.key}
      data-status={row.status}
      className="space-y-2 px-4 py-4 sm:px-5"
    >
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="flex min-w-0 items-center gap-2">
          {row.status === 'fixed' ? (
            <CheckCircleIcon aria-hidden className="size-4 shrink-0 text-success" />
          ) : row.status === 'info' ? (
            <InformationCircleIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : null}
          <span className={cn('truncate font-medium', !over && 'text-muted-foreground')}>
            {label}
          </span>
        </span>
        <span
          data-plan-limit-count=""
          className={cn(
            'shrink-0 font-mono text-[12px] tabular-nums',
            over ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {row.used} of {row.cap}
        </span>
      </div>
      {over ? (
        <Progress
          className="h-1.5"
          tone="over"
          value={row.used}
          max={Math.max(row.cap, 1)}
          aria-label={`${label}: ${row.used} of ${row.cap}`}
        />
      ) : null}
      {row.status === 'fixed' ? (
        <p className="text-[12px] text-muted-foreground">Fixed.</p>
      ) : row.note ? (
        <p className="text-[12px] text-muted-foreground">{row.note}</p>
      ) : null}
      {row.actions && over ? (
        <div data-plan-limit-actions="" className="flex flex-wrap items-center gap-2 pt-1">
          {row.actions}
        </div>
      ) : null}
    </li>
  )
}
