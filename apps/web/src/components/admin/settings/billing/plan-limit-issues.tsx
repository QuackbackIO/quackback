import type { ReactNode } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
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
 * The list of caps a workspace is over, shared by the Plan limits page and the
 * downgrade dialog so the two always show the same rows the same way.
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
        <li
          key={row.key}
          data-plan-limit-row={row.key}
          data-status={row.status}
          className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-6"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 text-[13px]">
              {row.status === 'fixed' ? (
                <CheckCircleIcon aria-hidden className="size-4 shrink-0 text-success" />
              ) : null}
              <span className="font-medium">{PLAN_CAP_LABELS[row.key]}</span>
              <span
                className={cn(
                  'font-mono text-[12px] tabular-nums',
                  row.status === 'over' ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {row.used} of {row.cap}
              </span>
            </div>
            {row.status === 'over' ? (
              <Progress
                className="h-1.5"
                tone="over"
                value={row.used}
                max={Math.max(row.cap, 1)}
                aria-label={`${PLAN_CAP_LABELS[row.key]}: ${row.used} of ${row.cap}`}
              />
            ) : null}
            {row.status === 'fixed' ? (
              <p className="text-[12px] text-muted-foreground">Fixed.</p>
            ) : row.note ? (
              <p className="text-[12px] text-muted-foreground">{row.note}</p>
            ) : null}
          </div>
          {row.actions && row.status === 'over' ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{row.actions}</div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
