import * as React from 'react'
import { cn } from '@/lib/shared/utils'

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  max?: number
  /**
   * A meaning that overrides the fill level: `over` is past a limit
   * (destructive fill on a destructive tint), `muted` is a count that needs
   * no action (a grey fill).
   */
  tone?: 'over' | 'muted'
}

const TONE_CLASS = {
  over: { track: 'bg-destructive/15', fill: 'bg-destructive' },
  muted: { track: 'bg-muted', fill: 'bg-muted-foreground' },
} as const

/** The fill's level: under 80%, 80-99% (nearly full) and 100% (full). Themes style it too. */
export function progressLevel(percent: number): 'ok' | 'warn' | 'full' {
  if (percent >= 100) return 'full'
  if (percent >= 80) return 'warn'
  return 'ok'
}

const FILL_CLASS = { ok: 'bg-primary', warn: 'bg-amber-500', full: 'bg-destructive' } as const

export function progressFillClass(percent: number): string {
  return FILL_CLASS[progressLevel(percent)]
}

function Progress({ className, value = 0, max = 100, tone, ...props }: ProgressProps) {
  const percentage = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  const toned = tone ? TONE_CLASS[tone] : null

  return (
    <div
      role="progressbar"
      data-slot="progress"
      data-tone={tone}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full',
        toned ? toned.track : 'bg-muted',
        className
      )}
      {...props}
    >
      <div
        data-slot="progress-fill"
        data-level={tone ?? progressLevel(percentage)}
        className={cn(
          'h-full transition-all duration-300 ease-out',
          toned ? toned.fill : progressFillClass(percentage)
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}

export { Progress }
