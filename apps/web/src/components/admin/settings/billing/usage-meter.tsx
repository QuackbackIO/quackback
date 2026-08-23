import type { ReactNode } from 'react'
import { Progress } from '@/components/ui/progress'

export function UsageMeter(props: {
  label: string
  valueText: string
  used: number
  limit: number
  footer?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[13px] font-medium">{props.label}</div>
        <div className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {props.valueText}
        </div>
      </div>
      <Progress value={props.used} max={Math.max(props.limit, 1)} />
      {(props.footer || props.action) && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] text-muted-foreground">{props.footer}</div>
          {props.action}
        </div>
      )}
    </div>
  )
}
