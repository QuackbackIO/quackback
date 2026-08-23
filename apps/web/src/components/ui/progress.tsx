import * as React from 'react'
import { cn } from '@/lib/shared/utils'

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  max?: number
}

export function progressFillClass(percent: number): string {
  if (percent >= 100) return 'bg-destructive'
  if (percent >= 80) return 'bg-amber-500'
  return 'bg-primary'
}

function Progress({ className, value = 0, max = 100, ...props }: ProgressProps) {
  const percentage = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        className={cn('h-full transition-all duration-300 ease-out', progressFillClass(percentage))}
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}

export { Progress }
