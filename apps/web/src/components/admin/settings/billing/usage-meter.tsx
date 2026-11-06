import type { ReactNode } from 'react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/shared/utils'

export function UsageMeter(props: {
  label: string
  description?: string
  valueText: string
  used: number
  limit: number
  /** A quiet line under the bar, for a state the numbers alone do not explain. */
  note?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-10">
      <div className="min-w-0 md:w-56 md:shrink-0">
        <div className="text-[13px] font-medium">{props.label}</div>
        {props.description ? (
          <div className="mt-0.5 text-[12px] text-muted-foreground">{props.description}</div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Progress
            className={cn('h-1.5 flex-1')}
            value={props.used}
            max={Math.max(props.limit, 1)}
          />
          <div className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
            {props.valueText}
          </div>
        </div>
        {props.note ? <div className="text-[12px] text-muted-foreground">{props.note}</div> : null}
      </div>
    </div>
  )
}
