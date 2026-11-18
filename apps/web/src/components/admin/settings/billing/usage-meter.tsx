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
  /** A small badge beside the label, such as "Over limit". */
  badge?: ReactNode
  /** `over` for a cap that needs a fix, `muted` for one that needs none. */
  tone?: 'over' | 'muted'
  /** Makes the whole row a link (an over-limit row opens Plan limits). */
  href?: string
}) {
  const body = (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-10">
      <div className="min-w-0 md:w-56 md:shrink-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium">
          {props.label}
          {props.badge}
        </div>
        {props.description ? (
          <div className="mt-0.5 text-[12px] text-muted-foreground">{props.description}</div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <Progress
            className={cn('h-1.5 flex-1')}
            tone={props.tone}
            value={props.used}
            max={Math.max(props.limit, 1)}
          />
          <div
            className={cn(
              'shrink-0 font-mono text-[12px] tabular-nums',
              props.tone === 'over' ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {props.valueText}
          </div>
        </div>
        {props.note ? <div className="text-[12px] text-muted-foreground">{props.note}</div> : null}
      </div>
    </div>
  )
  if (!props.href) return body
  return (
    <a
      href={props.href}
      data-usage-meter-link=""
      className="-mx-2 block rounded-lg px-2 py-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
    >
      {body}
    </a>
  )
}
